import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 does not forward rejected promises from async handlers to the
 * error middleware on its own. Wrapping every async route with this ensures
 * an unexpected throw still reaches the centralized error handler instead of
 * hanging the request.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
