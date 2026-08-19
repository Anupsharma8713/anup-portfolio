const express=require("express");
const multer=require("multer");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const app=express();
const PORT=process.env.PORT||3000;
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"anup123";
const TOKEN_SECRET=process.env.TOKEN_SECRET||ADMIN_PASSWORD+"-portfolio-secret";
// Vercel functions have a read-only project directory; /tmp is writable during an invocation.
const BASE="/tmp/anup-portfolio";
const DATA=path.join(BASE,"data","projects.json");
const UP=path.join(BASE,"uploads");
for(const d of [path.dirname(DATA),UP,path.join(UP,"videos"),path.join(UP,"models"),path.join(UP,"images")])fs.mkdirSync(d,{recursive:true});
if(!fs.existsSync(DATA))fs.writeFileSync(DATA,"[]");
const read=()=>JSON.parse(fs.readFileSync(DATA,"utf8"));
const write=x=>fs.writeFileSync(DATA,JSON.stringify(x,null,2));
function sign(value){return crypto.createHmac("sha256",TOKEN_SECRET).update(value).digest("hex")}
function makeToken(){const payload=Date.now()+":"+(Date.now()+24*60*60*1000);return Buffer.from(payload).toString("base64url")+"."+sign(payload)}
function validToken(token){try{const [b,s]=String(token||"").split(".");const payload=Buffer.from(b,"base64url").toString();if(!crypto.timingSafeEqual(Buffer.from(s||""),Buffer.from(sign(payload))))return false;return Number(payload.split(":")[1])>Date.now()}catch{return false}}
const storage=multer.diskStorage({destination:(req,file,cb)=>{const type=req.body.type;cb(null,type==="video"?path.join(UP,"videos"):file.fieldname==="thumbnail"?path.join(UP,"images"):path.join(UP,"models"))},filename:(req,file,cb)=>{const ext=path.extname(file.originalname).toLowerCase();cb(null,Date.now()+"-"+crypto.randomBytes(5).toString("hex")+ext)}});
const upload=multer({storage,limits:{fileSize:1024*1024*1024}});
app.use(express.json());app.use(express.static(path.join(__dirname,"public")));app.use("/uploads",express.static(UP));
app.post("/api/login",(req,res)=>{if(req.body.password!==ADMIN_PASSWORD)return res.status(401).json({error:"Wrong password"});res.json({token:makeToken()})});
function auth(req,res,next){const t=(req.headers.authorization||"").replace("Bearer ","");if(!validToken(t))return res.status(401).json({error:"Please login again"});next()}
app.get("/api/projects",(req,res)=>{try{res.json(read())}catch{res.json([])}});
app.post("/api/projects",auth,upload.fields([{name:"video",maxCount:1},{name:"model",maxCount:1},{name:"thumbnail",maxCount:1}]),(req,res)=>{try{const b=req.body;if(!b.title)return res.status(400).json({error:"Title required"});const f=req.files||{};const p={id:crypto.randomUUID(),type:b.type,title:b.title,category:b.category,tools:b.tools||"",description:b.description||"",duration:b.duration||"",format:b.format||"",published:true,created:new Date().toISOString()};if(b.type==="video"&&f.video)p.videoUrl="/uploads/videos/"+path.basename(f.video[0].path);if(b.type==="3d"&&f.model)p.modelUrl="/uploads/models/"+path.basename(f.model[0].path);if(f.thumbnail)p.thumbnail="/uploads/images/"+path.basename(f.thumbnail[0].path);const ps=read();ps.unshift(p);write(ps);res.json(p)}catch(e){console.error(e);res.status(500).json({error:"Upload failed"})}});
app.delete("/api/projects/:id",auth,(req,res)=>{try{const ps=read();const p=ps.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:"Not found"});for(const u of [p.videoUrl,p.modelUrl,p.thumbnail])if(u){const f=path.join(BASE,u.replace(/^\//,""));if(fs.existsSync(f))fs.unlinkSync(f)}write(ps.filter(x=>x.id!==p.id));res.json({ok:true})}catch{res.status(500).json({error:"Delete failed"})}});
app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));
if(require.main===module)app.listen(PORT,()=>console.log(`Portfolio running at http://localhost:${PORT}`));
module.exports=app;
