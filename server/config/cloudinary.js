const {v2:cloudinary}=require('cloudinary');
function configureCloudinary(){cloudinary.config({cloud_name:process.env.CLOUDINARY_CLOUD_NAME,api_key:process.env.CLOUDINARY_API_KEY,api_secret:process.env.CLOUDINARY_API_SECRET,secure:true});return cloudinary;}
module.exports={configureCloudinary};
