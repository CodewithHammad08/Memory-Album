function requireAuth(req,res,next){if(!req.session.userId)return res.status(401).json({error:'Authentication required.'});next();}
function csrf(req,res,next){if(['GET','HEAD','OPTIONS'].includes(req.method))return next();if(!req.session.csrfToken||req.get('x-csrf-token')!==req.session.csrfToken)return res.status(403).json({error:'Invalid security token.'});next();}
module.exports={requireAuth,csrf};
