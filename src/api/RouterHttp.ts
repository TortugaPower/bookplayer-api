import express from 'express';
import UserRouter from './UserRouter';
import LibraryRouter from './LibraryRouter';
import AdminRouter from './AdminRouter';
import StorageRouter from './StorageRouter';
import RetentionMessagingRouter from './RetentionMessagingRouter';
import PasskeyRouter from './PasskeyRouter';

const router = express.Router();

router.get('/status', (req, res) => res.send('OK'));
router.use('/user', UserRouter);
router.use('/passkey', PasskeyRouter);
router.use('/library', LibraryRouter);
router.use('/admin', AdminRouter);
router.use('/storage', StorageRouter);
router.use('/retention', RetentionMessagingRouter);

export default router;
