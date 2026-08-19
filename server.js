const express=require("express");
const multer=require("multer");
const fs=require("fs");
const path=require("path");
const os=require("os");
const crypto=require("crypto");
const app=express();
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"anup123";

// Vercel functions have a read-only project filesystem. Use /tmp for temporary uploads.
const UP=path.join(os.tmpdir(),"anup-portfolio-uploads");
for(const d of [UP,path.join(UP,"videos"),path.join(UP,"models"),path.join(UP,"images")])fs.mkdirSync(d,{recursive:true});
let projects=[];
const tokens=new Set();

const storage=multer.diskStorage({
 destination:(req,file,cb)=>{
  const type=req.body.type;
  cb(null,type==="video"?path.join(UP,"videos"):file.fieldname==="thumbnail"?path.join(UP,"images"):path.join(UP,"models"));
 },
 filename:(req,file,cb)=>{
  const ext=path.extname(file.originalname).toLowerCase();
  cb(null,Date.now()+"-"+crypto.randomBytes(5).toString("hex")+ext);
 }
});
const upload=multer({storage,limits:{fileSize:100*1024*1024}});

app.use(express.json());
app.use(express.static(path.join(__dirname,"public")));
app.use("/uploads",express.static(UP));

app.post("/api/login",(req,res)=>{
 if(req.body.password!==ADMIN_PASSWORD)return res.status(401).json({error:"Wrong password"});
 const token=crypto.randomBytes(24).toString("hex");tokens.add(token);res.json({token});
});
function auth(req,res,next){
 const t=(req.headers.authorization||"").replace("Bearer ","");
 if(!tokens.has(t))return res.status(401).json({error:"Please login again"});
 next();
}
app.get("/api/projects",(req,res)=>res.json(projects));
app.post("/api/projects",auth,upload.fields([{name:"video",maxCount:1},{name:"model",maxCount:1},{name:"thumbnail",maxCount:1}]),(req,res)=>{
 try{
  const b=req.body;
  if(!b.title)return res.status(400).json({error:"Title required"});
  const f=req.files||{};
  const p={id:crypto.randomUUID(),type:b.type,title:b.title,category:b.category,tools:b.tools||"",description:b.description||"",duration:b.duration||"",format:b.format||"",published:true,created:new Date().toISOString()};
  if(b.type==="video"&&f.video)p.videoUrl="/uploads/videos/"+path.basename(f.video[0].path);
  if(b.type==="3d"&&f.model)p.modelUrl="/uploads/models/"+path.basename(f.model[0].path);
  if(f.thumbnail)p.thumbnail="/uploads/images/"+path.basename(f.thumbnail[0].path);
  projects.unshift(p);res.json(p);
 }catch(e){console.error(e);res.status(500).json({error:"Upload failed"});}
});
app.delete("/api/projects/:id",auth,(req,res)=>{
 const p=projects.find(x=>x.id===req.params.id);
 if(!p)return res.status(404).json({error:"Not found"});
 for(const u of [p.videoUrl,p.modelUrl,p.thumbnail])if(u){const f=path.join(__dirname,u.replace(/^\//,""));try{if(fs.existsSync(f))fs.unlinkSync(f)}catch{}}
 projects=projects.filter(x=>x.id!==p.id);res.json({ok:true});
});
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));

// Vercel imports the Express app as a serverless function.
module.exports=app;
