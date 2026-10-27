'use strict';

const { HttpError } = require('./service');

async function handleAction(service, openid, action, data = {}) {
  switch (action) {
    case 'login':
      return service.login(openid, data.name);
    case 'logout':
      return { ok:true };
    case 'health':
      return { ok:true };
    default:
      break;
  }
  const user = await service.requireUser(openid);
  switch (action) {
    case 'me':
      return { user:service.profile(user), rooms:await service.myRooms(user) };
    case 'updateProfile':
      return { user:await service.updateProfile(user, data) };
    case 'createRoom':
      return service.createRoom(user, data);
    case 'join':
      return service.join(user, data.code, data.input || {});
    case 'command':
      return service.command(user, data.code, data.input || {});
    case 'controls':
      return service.setControls(user, data.code, data.input || {});
    case 'social':
      return service.social(user, data.code, data.kind, data.input || {});
    case 'view': {
      if (data.after !== undefined && (!Number.isInteger(data.after) || data.after < 0)) throw new HttpError(400, '房间版本号无效');
      const room = await service.room(data.code);
      service.member(room, user);
      if (data.after === room.revision) return { code:room.code, revision:room.revision, unchanged:true };
      return service.view(room, user);
    }
    case 'history':
      return { matches:await service.history(user) };
    case 'exportMatch':
      return service.exportMatch(user, data.matchId);
    default:
      throw new HttpError(404, '云端接口不存在');
  }
}

module.exports = { handleAction };
