import { IRequest, IResponse, INext } from '../../types/http';
import { UserServices } from '../../services/UserServices';

const userService = new UserServices();

export const checkUserAdmin = async (
  req: IRequest,
  res: IResponse,
  next: INext,
): Promise<void> => {
  try {
    const user = req.user;
    if (user) {
      const isAdmin = await userService.checkIfAdmin(user.id_user);
      if (!isAdmin) {
        return res.status(403).json({ message: 'You are not allowed here' });
      }
      next();
    } else {
      return res.status(400).json({ message: 'the user is invalid' });
    }
  } catch (error) {
    next(error);
  }
};
