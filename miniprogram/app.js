'use strict';

const config = typeof require === 'function' ? require('./config') : {};

App({
  onLaunch() {
    if (config.cloudEnv && wx.cloud && wx.cloud.init) {
      try {
        wx.cloud.init({ env:config.cloudEnv, traceUser:true });
      } catch (error) {
        console.error('wx.cloud.init failed:', error);
      }
    }
  },
  onShow(options) {
    const code=options.query&&options.query.room;
    if(typeof code==='string'&&/^[A-Z0-9]{8}$/i.test(code))wx.setStorageSync('invitedRoom',code.toUpperCase());
  },
  globalData: {},
});
