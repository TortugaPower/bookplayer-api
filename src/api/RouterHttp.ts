import express from 'express';
import UserRouter from './UserRouter';
import LibraryRouter from './LibraryRouter';
import RetentionMessagingRouter from './RetentionMessagingRouter';
import PasskeyRouter from './PasskeyRouter';
import BillingRouter from './BillingRouter';

const router = express.Router();

router.get('/status', (req, res) => res.send('OK'));
router.use('/user', UserRouter);
router.use('/passkey', PasskeyRouter);
router.use('/library', LibraryRouter);
router.use('/retention', RetentionMessagingRouter);
router.use('/billing', BillingRouter);

export default router;
