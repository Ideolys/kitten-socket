const uidPrefix    = 'c';
let prevTimestamp  = 0;
let sameUIDCounter = 0;

const helper = {
  /**
   * Generate a unique id
   * @return {String} unique id 
   */
  getUID : function () {
    var _timestamp = Date.now();
    var _uid = uidPrefix + '_' +_timestamp + '_' + process.pid + '_';
    if (_timestamp === prevTimestamp) {
      _uid += ++sameUIDCounter;
    }
    else {
      _uid += '0';
      sameUIDCounter = 0;
    }
    prevTimestamp = _timestamp;
    return _uid;
  }

};

module.exports = helper;