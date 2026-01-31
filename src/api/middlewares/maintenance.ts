import { IRequest, IResponse, INext } from '../../interfaces/IRequest';

/**
 * Maintenance mode middleware.
 *
 * Enable by setting a scheduled window (auto-disables after end time):
 *   MAINTENANCE_START=2026-02-01T07:00:00Z
 *   MAINTENANCE_END=2026-02-01T07:30:00Z
 */

function isInMaintenanceWindow(): boolean {
  const startTime = process.env.MAINTENANCE_START;
  const endTime = process.env.MAINTENANCE_END;

  if (startTime && endTime) {
    const now = new Date();
    const start = new Date(startTime);
    const end = new Date(endTime);

    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      return now >= start && now <= end;
    }
  }

  return false;
}

export const maintenanceMode = (
  req: IRequest,
  res: IResponse,
  next: INext,
) => {
  // Allow health checks to pass through
  if (req.path === '/v1/status' || req.path === '/status') {
    return next();
  }

  if (isInMaintenanceWindow()) {
    return res.status(503).json({
      status: 503,
      message:
        'BookPlayer is currently undergoing scheduled maintenance. Please try again in 15-20 minutes.',
    });
  }

  return next();
};
