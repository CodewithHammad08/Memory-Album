const {Schema,model}=require('mongoose');
module.exports=model('User',new Schema({username:{type:String,required:true,unique:true,trim:true,minlength:3,maxlength:60},passwordHash:{type:String,required:true,select:false},encryptionSalt:{type:String,required:true},recoveryMetadata:{type:String,default:''}},{timestamps:true}));
