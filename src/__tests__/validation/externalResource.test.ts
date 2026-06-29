import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { validateBody } from '../../validation/validate';
import {
  putExternalResourceSchema,
  deleteExternalResourceSchema,
  itemPutRequestSchema,
} from '../../validation/externalResource';

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

describe('validateBody middleware', () => {
  let res: any;
  let next: jest.Mock;

  beforeEach(() => {
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe('putExternalResourceSchema', () => {
    it('calls next() and rewrites req.body with coerced/whitelisted data', () => {
      const req: any = {
        body: {
          uuid: VALID_UUID,
          providerName: 'dropbox',
          providerId: 'file-1',
          syncStatus: 'pending',
          lastSyncedAt: '2026-06-01T00:00:00.000Z',
          extraneous: 'should be stripped',
        },
      };

      validateBody(putExternalResourceSchema)(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      // defaults applied
      expect(req.body.processedFile).toBe(false);
      expect(req.body.hostId).toBeNull();
      // ISO string coerced to Date
      expect(req.body.lastSyncedAt).toBeInstanceOf(Date);
      // unknown key stripped
      expect(req.body.extraneous).toBeUndefined();
    });

    it('422s with a field message when a required field is missing', () => {
      const req: any = {
        body: { uuid: VALID_UUID, providerId: 'file-1', syncStatus: 'pending' },
      };

      validateBody(putExternalResourceSchema)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ message: 'providerName is required' });
      expect(next).not.toHaveBeenCalled();
    });

    it('422s with an empty/whitespace required field', () => {
      const req: any = {
        body: { uuid: VALID_UUID, providerName: '   ', providerId: 'file-1', syncStatus: 'pending' },
      };

      validateBody(putExternalResourceSchema)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ message: 'providerName is required' });
      expect(next).not.toHaveBeenCalled();
    });

    it('422s on an invalid uuid', () => {
      const req: any = {
        body: { uuid: 'not-a-uuid', providerName: 'dropbox', providerId: 'file-1', syncStatus: 'pending' },
      };

      validateBody(putExternalResourceSchema)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ message: 'A valid item uuid is required' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('deleteExternalResourceSchema', () => {
    it('calls next() on a valid body', () => {
      const req: any = {
        body: { uuid: VALID_UUID, providerName: 'dropbox', providerId: 'file-1' },
      };
      validateBody(deleteExternalResourceSchema)(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('422s when providerId is missing', () => {
      const req: any = { body: { uuid: VALID_UUID, providerName: 'dropbox' } };
      validateBody(deleteExternalResourceSchema)(req, res, next);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ message: 'providerId is required' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('itemPutRequestSchema', () => {
    it('calls next() with only uuid (uploaded optional)', () => {
      const req: any = { body: { uuid: VALID_UUID } };
      validateBody(itemPutRequestSchema)(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('422s on a missing uuid', () => {
      const req: any = { body: { uploaded: true } };
      validateBody(itemPutRequestSchema)(req, res, next);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ message: 'A valid item uuid is required' });
      expect(next).not.toHaveBeenCalled();
    });

    it('422s when uploaded is not a boolean', () => {
      const req: any = { body: { uuid: VALID_UUID, uploaded: 'yes' } };
      validateBody(itemPutRequestSchema)(req, res, next);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
