import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import Joi from "joi";
import { JwtPayload } from "jsonwebtoken";
import { Types } from "mongoose";
import { nanoid } from "nanoid";
import { Blog } from "../models/blog.model";
import { Comment } from "../models/comment.model";
import { User } from "../models/user.model";
import { SortQuery } from "../types";
import { APIResponse, APIStatus } from "../types/api-response";
import BadRequestError from "../utils/errors/bad-request";
import CustomAPIError from "../utils/errors/custom-api";
import NotFoundError from "../utils/errors/not-found";
import { mongoIdValidator } from "../utils/joi-custom-types";
import logger from "../utils/logger";

const SPECIAL_CHARS_REGEX = /[^a-zA-Z0-9]/g; // find all special characters
const SPACE_REGEX = /\s+/g; // find one or more consecutives space

const validateCreateBlog = (blog: any, isDraft: boolean) => {
  const contentSchema = Joi.object({
    blocks: Joi.array()
      .items(
        Joi.object({
          id: Joi.string(),
          type: Joi.string().required(),
          data: Joi.object().required(),
        }).required()
      )
      .required(),
  });

  const draftBlogSchema = Joi.object({
    title: Joi.string().required(),
    description: Joi.string().min(0).max(200),
    content: contentSchema,
    tags: Joi.array().items(Joi.string()).max(10),
    coverImgURL: Joi.string().min(0),
    isDraft: Joi.boolean(),
  });

  const publishBlogSchema = Joi.object({
    title: Joi.string().required(),
    description: Joi.string().max(200).required(),
    content: contentSchema.required(),
    tags: Joi.array().items(Joi.string().required()).max(10).required(),
    coverImgURL: Joi.string(),
    isDraft: Joi.boolean(),
  });

  const schema = isDraft ? draftBlogSchema : publishBlogSchema;

  const { error } = schema.validate(blog);
  if (error) {
    let errorMessage = error.details[0].message;
    logger.error(`Input Validation Error! \n ${errorMessage}`);
    throw new BadRequestError(errorMessage);
  }
};

const createBlog = async (req: Request, res: Response) => {
  logger.debug(`${req.method} Request on Route -> ${req.baseUrl}`);

  const isDraft = Boolean(req.body.isDraft);

  // validate request body
  validateCreateBlog(req.body, isDraft);

  const authorId = (req.user as JwtPayload).id;
  let { title, description, content, coverImgURL, tags } = req.body;

  // create unique blogId
  let blogId =
    title.replace(SPECIAL_CHARS_REGEX, " ").replace(SPACE_REGEX, "-").trim() +
    nanoid();

  tags = tags?.map((tag: string) => tag.toLowerCase());

  //create blog
  let blog = new Blog({
    blogId,
    title,
    description,
    content,
    coverImgURL,
    tags,
    author: authorId,
    isDraft,
  });

  // save blog
  blog = await blog.save();

  // -----  update user document -----
  // 1. Increment total posts count when blog is published
  // 2. Add blog id to blogs array
  const user = await User.findOneAndUpdate(
    { _id: authorId },
    {
      $inc: { "accountInfo.totalPosts": blog.isDraft ? 0 : 1 },
      $push: {
        blogs: blog.id,
      },
    }
  );

  if (!user)
    throw new CustomAPIError(
      "Failed to update total posts count",
      StatusCodes.INTERNAL_SERVER_ERROR
    );

  const data: APIResponse = {
    status: APIStatus.SUCCESS,
    statusCode: StatusCodes.CREATED,
    result: {
      id: blog.blogId,
    },
  };

  return res.status(data.statusCode).json(data);
};

const validateBlogQueryParams = (query: any) => {
  const schema = Joi.object({
    tag: Joi.string(),
    search: Joi.string(),
    ordering: Joi.string(),
    authorId: mongoIdValidator.objectId(),
    page: Joi.number(),
    pageSize: Joi.number(),
    draft: Joi.boolean(),
  });

  const { error } = schema.validate(query);
  if (error) {
    let errorMessage = error.details[0].message;
    logger.error(`Input Validation Error! \n ${errorMessage}`);
    throw new BadRequestError(errorMessage);
  }
};

const getLatestBlogs = async (req: Request, res: Response) => {
  logger.debug(`${req.method} Request on Route -> ${req.baseUrl}`);

  // validate request query params
  validateBlogQueryParams(req.query);

  const {
    tag,
    authorId,
    search,
    ordering,
    page = 1,
    pageSize = 10,
    draft,
  } = req.query;

  const max_limit = parseInt(pageSize as string);
  const skip = (parseInt(page as string) - 1) * max_limit;

  const matchQuery: any = {
    isDraft: draft
      ? (draft as string).toLowerCase() === "true"
        ? true
        : false
      : false,
    ...(authorId && { author: new Types.ObjectId(authorId as string) }),
    ...(tag && { tags: (tag as string).toLowerCase() }),
  };

  const searchQuery: any = search
    ? {
        $or: [
          { title: new RegExp(`${search}`, "i") },
          {
            "authorDetails.personalInfo.fullname": new RegExp(`${search}`, "i"),
          },
          {
            "authorDetails.personalInfo.username": new RegExp(`${search}`, "i"),
          },
        ],
      }
    : {};

  const sortQuery: SortQuery =
    ordering && (ordering as string).toLowerCase() === "trending"
      ? {
          "activity.totalReads": -1,
          "activity.totalLikes": -1,
          createdAt: -1,
        }
      : { createdAt: -1 };

  // Get total count of documents for pagination
  const totalCount = await Blog.countDocuments({
    ...matchQuery,
    ...searchQuery,
  });

  const blogs = await Blog.aggregate([
    {
      $match: matchQuery,
    },
    {
      $lookup: {
        from: "users",
        localField: "author",
        foreignField: "_id",
        as: "authorDetails",
      },
    },
    {
      $unwind: "$authorDetails",
    },
    {
      $match: searchQuery,
    },

    {
      $sort: sortQuery,
    },
    {
      $skip: skip,
    },
    {
      $limit: max_limit,
    },
    {
      $project: {
        _id: 0,
        blogId: 1,
        title: 1,
        description: 1,
        coverImgURL: 1,
        tags: 1,
        activity: 1,
        createdAt: 1,
        "authorDetails.personalInfo.fullname": 1,
        "authorDetails.personalInfo.username": 1,
        "authorDetails.personalInfo.profileImage": 1,
        isDraft: 1,
      },
    },
  ]);

  const queryParams = new URLSearchParams(req.query as any);
  queryParams.delete("page");
  queryParams.delete("pageSize");

  const baseUrlWithQuery = `${req.protocol}://${req.get("host")}${
    req.baseUrl
  }?${queryParams.toString()}`;

  const nextPage =
    skip + max_limit < totalCount
      ? `${baseUrlWithQuery}&page=${
          parseInt(page as string) + 1
        }&pageSize=${max_limit}`
      : null;
  const previousPage =
    skip > 0
      ? `${baseUrlWithQuery}&page=${
          parseInt(page as string) - 1
        }&pageSize=${max_limit}`
      : null;

  const data: APIResponse = {
    status: APIStatus.SUCCESS,
    statusCode: StatusCodes.OK,
    count: totalCount,
    next: nextPage,
    previous: previousPage,
    results: blogs,
  };

  return res.status(data.statusCode).json(data);
};

const getBlogById = async (req: Request, res: Response) => {
  logger.debug(`${req.method} Request on Route -> ${req.baseUrl}/:blogId`);

  const { blogId } = req.params;
  const blog = await Blog.findOne({ blogId })
    .populate(
      "author",
      "personalInfo.fullname personalInfo.username personalInfo.profileImage _id"
    )
    .select(
      "blogId title description content coverImgURL tags activity createdAt likes isDraft _id"
    );

  if (!blog) throw new NotFoundError(`No blog found with blogId = ${blogId}`);

  const data: APIResponse = {
    status: APIStatus.SUCCESS,
    statusCode: StatusCodes.OK,
    result: blog.toJSON(),
  };

  return res.status(data.statusCode).json(data);
};

const updateReadCount = async (req: Request, res: Response) => {
  logger.debug(
    `${req.method} Request on Route -> ${req.baseUrl}/:blogId/readCount`
  );

  const { blogId } = req.params;

  // Increment total read count of blog by 1
  const blog = await Blog.findOneAndUpdate(
    { blogId },
    { $inc: { "activity.totalReads": 1 } },
    { new: true }
  )
    .populate("author", "personalInfo.fullname personalInfo.username -_id")
    .select("blogId title activity createdAt -_id");

  if (!blog) throw new NotFoundError(`No blog found with blogId = ${blogId}`);

  // Increment total read count of user by 1
  const user = await User.findOneAndUpdate(
    {
      "personalInfo.username": blog.author.personalInfo.username,
    },
    { $inc: { "accountInfo.totalReads": 1 } },
    { new: true }
  );

  if (!user) throw new Error("User not found. Unable to update read counts");

  const data: APIResponse = {
    status: APIStatus.SUCCESS,
    statusCode: StatusCodes.OK,
    result: {
      blogId: blog.blogId,
      title: blog.title,
      author: blog.author,
      activity: blog.activity,
    },
  };

  return res.status(data.statusCode).json(data);
};

const updateBlogById = async (req: Request, res: Response) => {
  logger.debug(`${req.method} Request on Route -> ${req.baseUrl}/:blogId`);

  // get blog by blogId
  const { blogId } = req.params;
  const blog = await Blog.findOne({ blogId });
  if (!blog) throw new NotFoundError(`No blog found with blogId = ${blogId}`);

  const isDraft = Boolean(req.body.isDraft);
  // validate request body
  validateCreateBlog(req.body, isDraft);

  let { tags } = req.body;
  tags = tags?.map((tag: string) => tag.toLowerCase());

  // update Blog
  const updatedBlog = await Blog.findOneAndUpdate(
    { blogId },
    { ...req.body, tags },
    {
      new: true,
    }
  )
    .populate(
      "author",
      "personalInfo.fullname personalInfo.username personalInfo.profileImage _id"
    )
    .select(
      "blogId title description content coverImgURL tags activity createdAt isDraft -_id"
    );

  // increment user total post count if draft blog is getting published
  if (blog.isDraft && !isDraft) {
    const user = await User.findOneAndUpdate(
      { _id: blog.author },
      {
        $inc: { "accountInfo.totalPosts": 1 },
      }
    );

    if (!user)
      throw new CustomAPIError(
        "Failed to update total posts count",
        StatusCodes.INTERNAL_SERVER_ERROR
      );
  }

  const data: APIResponse = {
    status: APIStatus.SUCCESS,
    statusCode: StatusCodes.OK,
    result: updatedBlog,
  };

  return res.status(data.statusCode).json(data);
};

const updateLike = async (req: Request, res: Response) => {
  logger.debug(`${req.method} Request on Route -> ${req.baseUrl}/:blogId/like`);

  const userId = (req.user as JwtPayload).id;
  const { blogId } = req.params;

  // get blog
  const blog = await Blog.findOne({ blogId }).select("likes");
  if (!blog) throw new NotFoundError(`No blog found with blogId = ${blogId}`);

  const isLiked = blog.likes.get(userId);
  if (isLiked) {
    // unlike blog
    blog.likes.delete(userId);
  } else {
    // like blog
    blog.likes.set(userId, true);
  }

  const updatedBlog = await Blog.findByIdAndUpdate(
    blog.id,
    {
      likes: blog.likes,
      $inc: { "activity.totalLikes": isLiked ? -1 : 1 },
    },
    { new: true }
  ).select("blogId title activity author -_id");

  const data: APIResponse = {
    status: APIStatus.SUCCESS,
    statusCode: StatusCodes.OK,
    result: updatedBlog,
  };

  return res.status(data.statusCode).json(data);
};

const deleteBlogByBlogId = async (req: Request, res: Response) => {
  logger.debug(`${req.method} Request on Route -> ${req.baseUrl}/:blogId`);

  const { blogId } = req.params;

  // delete blog
  const deletedBlog = await Blog.findOneAndDelete({ blogId })
    .populate("author", "personalInfo.fullname personalInfo.username _id")
    .select("blogId title isDraft");

  if (!deletedBlog)
    throw new NotFoundError(`No blog found with blogId = ${blogId}`);

  const { id, author, isDraft } = deletedBlog;
  // update author
  // - remove blog from author blogs list
  // - decrement total post count if published blog is deleted
  const user = await User.findByIdAndUpdate(author.id, {
    $inc: { "accountInfo.totalPosts": isDraft ? 0 : -1 },
    $pull: {
      blogs: id,
    },
  });
  if (!user)
    throw new CustomAPIError(
      "Failed to update user blogs and total posts count",
      StatusCodes.INTERNAL_SERVER_ERROR
    );

  // delete all comments and replies associated with this blog
  const retur = await Comment.deleteMany({ blogId: id });

  const data: APIResponse = {
    status: APIStatus.SUCCESS,
    statusCode: StatusCodes.OK,
    result: deletedBlog,
  };

  return res.status(data.statusCode).json(data);
};

export {
  createBlog,
  deleteBlogByBlogId,
  getBlogById,
  getLatestBlogs,
  updateBlogById,
  updateLike,
  updateReadCount,
};
