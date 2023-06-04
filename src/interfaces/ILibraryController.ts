import { IRequest, IResponse, INext } from './IRequest';

export interface ILibraryController {
  getLibraryContentPath(
    req: IRequest,
    res: IResponse,
    _: INext,
  ): Promise<IResponse>;
  getLibraryObject(req: IRequest, res: IResponse, _: INext): Promise<IResponse>;
  putLibraryObject(req: IRequest, res: IResponse, _: INext): Promise<IResponse>;
  deleteLibraryObject(
    req: IRequest,
    res: IResponse,
    _: INext,
  ): Promise<IResponse>;
  reorderLibraryObject(
    req: IRequest,
    res: IResponse,
    _: INext,
  ): Promise<IResponse>;
  moveLibraryObject(
    req: IRequest,
    res: IResponse,
    _: INext,
  ): Promise<IResponse>;
  deleteFolderMoving(
    req: IRequest,
    res: IResponse,
    _: INext,
  ): Promise<IResponse>;
  getLastPlayedItem(
    req: IRequest,
    res: IResponse,
    _: INext,
  ): Promise<IResponse>;
  getAllUserBookmarks(
    req: IRequest,
    res: IResponse,
    _: INext,
  ): Promise<IResponse>;
  upsertBookmark(req: IRequest, res: IResponse, _: INext): Promise<IResponse>;
  itemThumbnailPutRequest(
    req: IRequest,
    res: IResponse,
    _: INext,
  ): Promise<IResponse>;
  renameLibraryObject(
    req: IRequest,
    res: IResponse,
    _: INext,
  ): Promise<IResponse>;
}
