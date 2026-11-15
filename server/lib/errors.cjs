'use strict';
class HttpError extends Error {
  constructor(status,message){super(message);this.status=status;}
}
const fail=(status,message)=>{throw new HttpError(status,message);};
function text(value,min,max,label){
  if(typeof value!=='string'||value.length<min||value.length>max||/[\x00-\x1f\x7f]/.test(value))
    fail(400,'Invalid '+label);
  return value;
}
module.exports={HttpError,fail,text};
