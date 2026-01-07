import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import mongoSanitize from "express-mongo-sanitize";
import cookieParser from 'cookie-parser';
import { validateEnv, getCorsConfig } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import routes from "./routes";
import logger from "./config/logger";

const env = validateEnv();

export function createApp(): Application {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors(getCorsConfig(env)));

  // Body parsing middleware
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(cookieParser());

  // Compression
  app.use(compression());

  // Logging
  if (env.NODE_ENV !== "production") {
    app.use(morgan("dev"));
  } else {
    app.use(
      morgan("combined", {
        stream: {
          write: (message: string) => logger.info(message.trim()),
        },
      })
    );
  }

  // Sanitize data
  app.use(mongoSanitize());

  // Rate limiting (currently disabled – enable when needed)
  // const limiter = rateLimit({
  //   windowMs: env.RATE_LIMIT_WINDOW_MS,
  //   max: env.RATE_LIMIT_MAX_REQUESTS,
  //   message: "Too many requests from this IP, please try again later.",
  //   standardHeaders: true,
  //   legacyHeaders: false,
  // });
  // app.use('/api/', limiter);

  app.use((req, _res, next) => {
    console.log("🔍 [USER SERVICE] Incoming headers:", {
      authorization: req.headers.authorization,
      xServiceAuth: req.headers["x-service-auth"],
      xServiceName: req.headers["x-service-name"],
    });
    next();
  });

  // Routes
  app.use("/api/v1", routes);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: "Not Found",
      message: `Route ${req.method} ${req.path} not found`,
    });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
