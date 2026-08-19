const express=require("express");
const multer=require("multer");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const {createClient}=require("@supabase/supabase-js");

const app=express();
const PORT=process.env.PORT||3000;
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"anup123";
const TOKEN_SECRET=process.env.TOKEN_SECRET||ADMIN_PASSWORD+"-portfolio-secret";
const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_KEY=process.env.SUPABASE_SECRET_KEY;
const supabase=SUPABASE_URL&&SUPABASE_KEY?createClient(SUPABASE_URL,SUPABASE_KEY):null;

const TMP="/tmp/anup-portfolio";
const UP=path.join(TMP,"uploads");
for(const d of [UP,path.join(UP,"videos"),path.join(UP,"models"),path.join(UP,"images")])fs.mkdirSync(d,{recursive:true});

function sign(value){return crypto.createHmac("sha256",TOKEN_SECRET).update(value).digest("hex")}
function makeToken(){const payload=Date.now()+":"+(Date.now()+24*60*60*1000);return Buffer.from(payload).toString("base64url")+"."+sign(payload)}
function validToken(token){try{const [b,s]=String(token||"").split(".");const payload=Buffer.from(b,"base64url").toString();const expected=sign(payload);if(!s||s.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(expected)))return false;return Number(payload.split(":")[1])>Date.now()}catch{return false}}
function requireSupabase(){if(!supabase)throw new Error("Supabase environment variables are missing")}

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
const upload=multer({storage,limits:{fileSize:1024*1024*1024}});

app.use(express.json());
app.use(express.static(path.join(__dirname,"public")));

app.post("/api/login",(req,res)=>{
  if(req.body.password!==ADMIN_PASSWORD)return res.status(401).json({error:"Wrong password"});
  res.json({token:makeToken()});
});
function auth(req,res,next){
  const t=(req.headers.authorization||"").replace("Bearer ","");
  if(!validToken(t))return res.status(401).json({error:"Please login again"});
  next();
}

app.get("/api/projects",async(req,res)=>{
  try{
    requireSupabase();
    const {data,error}=await supabase.from("projects").select("*").order("created",{ascending:false});
    if(error)throw error;
    res.json(data||[]);
  }catch(e){console.error(e);res.status(500).json({error:"Could not load projects"});}
});

async function uploadToBucket(bucket,file){
  if(!file)return null;
  const objectPath=Date.now()+"-"+crypto.randomBytes(6).toString("hex")+path.extname(file.originalname).toLowerCase();
  const body=fs.readFileSync(file.path);
  const {error}=await supabase.storage.from(bucket).upload(objectPath,body,{contentType:file.mimetype||"application/octet-stream",upsert:false});
  if(error)throw error;
  return supabase.storage.from(bucket).getPublicUrl(objectPath).data.publicUrl;
}

app.post("/api/projects",auth,upload.fields([{name:"video",maxCount:1},{name:"model",maxCount:1},{name:"thumbnail",maxCount:1}]),async(req,res)=>{
  const files=req.files||{};
  try{
    requireSupabase();
    const b=req.body;
    if(!b.title)return res.status(400).json({error:"Title required"});
    if(b.type==="video"&&!files.video?.[0])return res.status(400).json({error:"Video file required"});
    if(b.type==="3d"&&!files.model?.[0])return res.status(400).json({error:"3D model file required"});

    const videoUrl=b.type==="video"?await uploadToBucket("portfolio-videos",files.video[0]):null;
    const modelUrl=b.type==="3d"?await uploadToBucket("portfolio-models",files.model[0]):null;
    const thumbnailUrl=files.thumbnail?.[0]?await uploadToBucket("portfolio-thumbnails",files.thumbnail[0]):null;

    const p={type:b.type,title:b.title,category:b.category||"",tools:b.tools||"",description:b.description||"",duration:b.duration||"",format:b.format||"",published:true,video_url:videoUrl,model_url:modelUrl,thumbnail_url:thumbnailUrl};
    const {data,error}=await supabase.from("projects").insert(p).select("*").single();
    if(error)throw error;
    res.json({id:data.id,type:data.type,title:data.title,category:data.category,tools:data.tools,description:data.description,duration:data.duration,format:data.format,published:data.published,videoUrl:data.video_url,modelUrl:data.model_url,thumbnail:data.thumbnail_url,created:data.created});
  }catch(e){
    console.error(e);
    res.status(500).json({error:"Upload failed: "+(e.message||"unknown error")});
  }finally{
    for(const group of Object.values(files))for(const file of group||[])try{fs.unlinkSync(file.path)}catch{}
  }
});

app.delete("/api/projects/:id",auth,async(req,res)=>{
  try{
    requireSupabase();
    const {data:p,error:getError}=await supabase.from("projects").select("*").eq("id",req.params.id).single();
    if(getError||!p)return res.status(404).json({error:"Not found"});
    for(const [url,bucket] of [[p.video_url,"portfolio-videos"],[p.model_url,"portfolio-models"],[p.thumbnail_url,"portfolio-thumbnails"]]){
      if(url){const marker=`/${bucket}/`;const i=url.indexOf(marker);if(i>=0){const objectPath=url.slice(i+marker.length);await supabase.storage.from(bucket).remove([objectPath]);}}
    }
    const {error}=await supabase.from("projects").delete().eq("id",req.params.id);
    if(error)throw error;
    res.json({ok:true});
  }catch(e){console.error(e);res.status(500).json({error:"Delete failed"});}
});

app.get("/admin",(req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));
if(require.main===module)app.listen(PORT,()=>console.log(`Portfolio running at http://localhost:${PORT}`));
module.exports=app;
