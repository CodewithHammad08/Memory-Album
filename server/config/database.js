const mongoose=require('mongoose');
async function connectDatabase(uri){mongoose.set('strictQuery',true);await mongoose.connect(uri,{dbName:'our_story',serverSelectionTimeoutMS:10000});console.info('MongoDB connected');}
module.exports={connectDatabase};
