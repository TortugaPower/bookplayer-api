import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { IRequest, IResponse } from '../types/http';
import type { RetentionMessagingService } from '../services/RetentionMessagingService';
import type { LoggerService } from '../services/LoggerService';
import { RealtimeResponseBody } from '../types/retentionMessaging';

@injectable()
export class RetentionMessagingController {
  @inject(TYPES.RetentionMessagingService)
  private _retentionService: RetentionMessagingService;
  @inject(TYPES.LoggerService)
  private _logger: LoggerService;

  public async HandleRetentionRequest(
    req: IRequest,
    res: IResponse,
  ): Promise<IResponse> {
    try {
      const { signedPayload } = req.body;

      if (!signedPayload) {
        this._logger.log({
          origin: 'RetentionMessagingController.HandleRetentionRequest',
          message: 'Missing signedPayload in request body',
        });
        return res.status(400).json({});
      }

      // Verify and decode the JWS signed payload from Apple
      const request = await this._retentionService.VerifyAndDecodeRequest(signedPayload);

      // Select the appropriate retention message
      const messageId = await this._retentionService.SelectRetentionMessage(request);

      if (!messageId) {
        // Return empty object to let Apple use default message
        return res.json({});
      }

      const response: RealtimeResponseBody = { messageId };
      return res.json(response);
    } catch (err) {
      this._logger.log({
        origin: 'RetentionMessagingController.HandleRetentionRequest',
        message: err.message,
      }, 'error');
      // Return empty response on error - Apple will use default message
      return res.status(400).json({});
    }
  }
}
