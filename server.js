"use strict";
const express=require("express"),cors=require("cors"),{Pool}=require("pg"),bcrypt=require("bcryptjs"),jwt=require("jsonwebtoken"),path=require("path");
const app=express(),secret=process.env.JWT_SECRET;
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="true"?{rejectUnauthorized:true}:undefined});
app.disable("x-powered-by");
app.use(cors({origin:process.env.FRONTEND_ORIGIN?process.env.FRONTEND_ORIGIN.split(",").map(x=>x.trim()):false}));
app.use(express.json({limit:"12mb"}));
const error=(res,status,message)=>res.status(status).json({success:false,error:message});
const emailOf=x=>typeof x==="string"?x.trim().toLowerCase():"";
const validEmail=x=>x.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
const tokenFor=id=>jwt.sign({userId:id},secret,{algorithm:"HS256",expiresIn:"7d"});
async function init(){
 await pool.query("CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,credits INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ DEFAULT NOW())");
 // Preserve all existing balances; zero applies only to future registrations.
 await pool.query("ALTER TABLE users ALTER COLUMN credits SET DEFAULT 0");
 await pool.query("CREATE TABLE IF NOT EXISTS generation_jobs(id UUID PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ DEFAULT NOW())");
}
function auth(req,res,next){
 const token=/^Bearer (.+)$/.exec(req.get("authorization")||"")?.[1];
 if(!token||!secret)return error(res,401,"Требуется вход");
 try{req.userId=jwt.verify(token,secret,{algorithms:["HS256"]}).userId;next();}
 catch{return error(res,401,"Сессия недействительна");}
}
app.get("/",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.get("/oferta.html",(req,res)=>res.sendFile(path.join(__dirname,"oferta.html")));
app.get("/api/health",(req,res)=>res.json({success:true,service:"Velora AI",status:"running"}));
app.post("/api/register",async(req,res)=>{
 try{
 const email=emailOf(req.body?.email),password=req.body?.password;
 if(!validEmail(email)||typeof password!=="string"||password.length<8||password.length>128)return error(res,400,"Проверьте email и пароль (8–128 символов)");
 if(!secret)return error(res,503,"Регистрация временно недоступна");
 const hash=await bcrypt.hash(password,12);
 const r=await pool.query("INSERT INTO users(email,password_hash,credits) VALUES($1,$2,0) ON CONFLICT(email) DO NOTHING RETURNING id,email,credits",[email,hash]);
 if(!r.rowCount)return error(res,409,"Email уже зарегистрирован");
 return res.status(201).json({success:true,token:tokenFor(r.rows[0].id),user:r.rows[0]});
 }catch(e){console.error("Register:",e.message);return error(res,500,"Ошибка регистрации");}
});
app.post("/api/login",async(req,res)=>{
 try{
 const email=emailOf(req.body?.email),password=req.body?.password;
 if(!validEmail(email)||typeof password!=="string")return error(res,400,"Введите email и пароль");
 if(!secret)return error(res,503,"Вход временно недоступен");
 const r=await pool.query("SELECT id,email,password_hash,credits FROM users WHERE email=$1",[email]);
 const u=r.rows[0];
 if(!u||!(await bcrypt.compare(password,u.password_hash)))return error(res,401,"Неверный email или пароль");
 return res.json({success:true,token:tokenFor(u.id),user:{id:u.id,email:u.email,credits:u.credits}});
 }catch(e){console.error("Login:",e.message);return error(res,500,"Ошибка входа");}
});
app.get("/api/me",auth,async(req,res)=>{
 try{const r=await pool.query("SELECT id,email,credits,created_at FROM users WHERE id=$1",[req.userId]);if(!r.rowCount)return error(res,404,"Аккаунт не найден");return res.json({success:true,user:r.rows[0]});}
 catch(e){console.error("Profile:",e.message);return error(res,500,"Ошибка профиля");}
});
// Paid mode: generation disabled until verified payments and provider API are configured.
// Never trust client-reported payment status or balance.
app.post("/api/generate",auth,(req,res)=>error(res,503,"Генерация ожидает подключения оплаты и провайдера"));
app.post("/api/video",auth,(req,res)=>error(res,503,"Видео ожидает подключения провайдера"));
app.get("/api/pricing",(req,res)=>res.json({success:true,available:false,currency:"RUB",plans:[]}));
(async()=>{if(!process.env.DATABASE_URL||!secret)throw Error("DATABASE_URL and JWT_SECRET required");await init();app.listen(process.env.PORT||3000,"0.0.0.0",()=>console.log("Velora AI server ready"));})().catch(e=>{console.error("Startup:",e.message);process.exit(1);});
