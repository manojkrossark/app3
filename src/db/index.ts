import config from "config";
import { connect } from "mongoose";
import logger from "../utils/logger";

const MONGODB_URI = "mongodb://localhost:27017";
// `mongodb+srv://${config.get("database.user")}:${config.get(
//   "database.password"
// )}@blogsphere.8uy0ntc.mongodb.net/${config.get(
//   "database.name"
// )}?retryWrites=true&w=majority&appName=blogsphere`;

const connectDB = async () => {
  try {
    await connect(MONGODB_URI, { autoIndex: true });
    logger.info("MongoDB connected");
  } catch (err) {
    logger.error(`MongoDB connection FAILED !! ${err}`);
  }
};

export default connectDB;
