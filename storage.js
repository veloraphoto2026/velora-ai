"use strict";
const {S3Client,PutObjectCommand,GetObjectCommand}=require("@aws-sdk/client-s3");
const {getSignedUrl}=require("@aws-sdk/s3-request-presigner");
const crypto=require("crypto");
const enabled=process.env.VELORA_STORAGE_ENABLED==="true";
const bucket=process.env.YC_STORAGE_BUCKET;
const configured=Boolean(enabled&&bucket&&process.env.YC_STORAGE_ACCESS_KEY_ID&&process.env.YC_STORAGE_SECRET_ACCESS_KEY);
const client=configured?new S3Client({region:"ru-central1",endpoint:"https://storage.yandexcloud.net",credentials:{accessKeyId:process.env.YC_STORAGE_ACCESS_KEY_ID,secretAccessKey:process.env.YC_STORAGE_SECRET_ACCESS_KEY},forcePathStyle:true}):null;
function keyFor(orderId,kind){if(!/^[1-9][0-9]*$/.test(String(orderId))||!["photo","video","audio"].includes(kind))throw Error("Invalid storage key");return "orders/"+orderId+"/"+kind+"-"+crypto.randomUUID();}
async function save(orderId,kind,source){
 if(!configured)return null;
 let bytes,type;
 if(typeof source!=="string")throw Error("Invalid source");
 if(source.startsWith("data:image/")){
  const m=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
  if(!m)throw Error("Unsupported image");
  bytes=Buffer.from(m[2],"base64");type="image/"+m[1];
 }else{
  const url=new URL(source);
  if(url.protocol!=="https:")throw Error("HTTPS required");
  // Provider URL is fetched server-side; block private and loopback destinations.
  if(!/^[a-z0-9.-]+$/i.test(url.hostname)||url.hostname==="localhost"||url.hostname.endsWith(".local")||url.hostname.endsWith(".internal")||/^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.)/.test(url.hostname))throw Error("Unsafe source host");
  const response=await fetch(url,{signal:AbortSignal.timeout(45000),redirect:"error"});
  if(!response.ok)throw Error("Provider file unavailable");
  const limit=kind==="video"?150*1024*1024:20*1024*1024;
  const length=Number(response.headers.get("content-length")||0);
  if(length>limit)throw Error("File too large");
  bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>limit)throw Error("File too large");
  type=response.headers.get("content-type")?.split(";")[0]||"application/octet-stream";
  if(kind==="photo"&&!type.startsWith("image/")||kind==="video"&&!type.startsWith("video/"))throw Error("Unexpected media type");
 }
 const key=keyFor(orderId,kind);
 await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:type,ServerSideEncryption:"AES256"}));
 return "yc-s3:"+key;
}
async function resolve(value){
 if(typeof value!=="string"||!value.startsWith("yc-s3:"))return value;
 if(!configured)throw Error("Storage unavailable");
 const key=value.slice(6);
 if(!/^orders\/[1-9][0-9]*\/(photo|video|audio)-[0-9a-f-]{36}$/.test(key))throw Error("Invalid object key");
 return getSignedUrl(client,new GetObjectCommand({Bucket:bucket,Key:key}),{expiresIn:600});
}
module.exports={configured,save,resolve};
