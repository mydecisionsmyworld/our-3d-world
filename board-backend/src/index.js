// Cloudflare Worker + D1 backend for a shared camp message board.
// Secrets (OWNER_KEY and optional AI_WRITE_KEY) live ONLY on the Worker, never in GitHub Pages.
const WORD_LIMIT=300, MAX_MESSAGES=30, MAX_PINS=3, MAX_COMMENTS=50;
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8",...headers}});
function words(text){return (String(text||'').trim().match(/\S+/g)||[]).length;}
function nameOf(raw){return String(raw||'Visitor').trim().slice(0,40)||'Visitor';}
function validateBody(text){return typeof text==='string'&&text.trim().length>0&&text.length<=5000&&words(text)<=WORD_LIMIT;}
async function hash(token){
 const bytes=new TextEncoder().encode(token),digest=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}
async function identity(request,env){
 const match=(request.headers.get('Authorization')||'').match(/^Bearer ([0-9a-f-]{30,150})$/i);
 if(!match)return null;
 const digest=await hash(match[1]);
 return await env.DB.prepare('SELECT id, role FROM visitors WHERE token_hash = ?').bind(digest).first();
}
function owner(request,env){
 const key=request.headers.get('X-Owner-Key')||'';
 return !!env.OWNER_KEY&&key.length>=24&&key===env.OWNER_KEY;
}
function aiWriter(request,env){
 const key=request.headers.get('X-AI-Key')||'';
 return !!env.AI_WRITE_KEY&&key.length>=24&&key===env.AI_WRITE_KEY;
}
async function body(request){
 try{return await request.json();}catch(e){return null;}
}
async function rateLimit(env,visitor,table,max,periodMs){
 const now=Date.now();
 const row=await env.DB.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE author_id=? AND created_at>=?')
  .bind(visitor,now-periodMs).first();
 return (row?.n||0)<max;
}
async function trimMessages(env){
 // Expiry is by post order, including pinned posts. A pinned message is not exempt.
 await env.DB.prepare('DELETE FROM posts WHERE id NOT IN (SELECT id FROM posts ORDER BY created_at DESC,id DESC LIMIT 30)').run();
}
async function createPost(env,authorId,name,text){
 const id=crypto.randomUUID(),time=Date.now();
 const statements=[
  env.DB.prepare('INSERT INTO posts(id,author_id,name,body,created_at,pinned) VALUES(?,?,?,?,?,0)')
   .bind(id,authorId,name,text.trim(),time),
  env.DB.prepare('DELETE FROM posts WHERE id NOT IN (SELECT id FROM posts ORDER BY created_at DESC,id DESC LIMIT 30)')
 ];
 await env.DB.batch(statements);
 return {id};
}
async function createComment(env,postId,authorId,name,text){
 const exists=await env.DB.prepare('SELECT id FROM posts WHERE id=?').bind(postId).first();
 if(!exists)return json({error:'Message expired or not found.'},404);
 const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE post_id=?').bind(postId).first();
 if(count.n>=MAX_COMMENTS)return json({error:'This message has reached its comment limit.'},409);
 const id=crypto.randomUUID();
 await env.DB.prepare('INSERT INTO comments(id,post_id,author_id,name,body,created_at) VALUES(?,?,?,?,?,?)')
  .bind(id,postId,authorId,name,text.trim(),Date.now()).run();
 return json({id},201);
}
async function readPosts(env,viewer,ownerMode){
 const posts=(await env.DB.prepare('SELECT id,author_id,name,body,created_at,pinned FROM posts ORDER BY pinned DESC,created_at DESC,id DESC LIMIT 30').all()).results;
 const comments=(await env.DB.prepare('SELECT post_id,id,name,body,created_at FROM comments ORDER BY created_at ASC').all()).results;
 const likes=(await env.DB.prepare('SELECT post_id,visitor_id FROM likes').all()).results;
 const byPost=new Map(posts.map(p=>[p.id,[]]));
 const counts=new Map(),liked=new Set();
 for(const c of comments)if(byPost.has(c.post_id))byPost.get(c.post_id).push({id:c.id,name:c.name,text:c.body,createdAt:c.created_at});
 for(const v of likes){
  counts.set(v.post_id,(counts.get(v.post_id)||0)+1);
  if(viewer&&v.visitor_id===viewer.id)liked.add(v.post_id);
 }
 return posts.map(p=>({id:p.id,name:p.name,text:p.body,createdAt:p.created_at,pinned:!!p.pinned,
   own:!!viewer&&p.author_id===viewer.id,canDelete:ownerMode,likeCount:counts.get(p.id)||0,liked:liked.has(p.id),
   commentCount:byPost.get(p.id)?.length||0,comments:byPost.get(p.id)||[]}));
}
async function handle(request,env){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(method==='POST'&&path==='/api/session'){
  const id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID(),digest=await hash(token);
  await env.DB.prepare('INSERT INTO visitors(id,token_hash,role,created_at) VALUES(?,?,?,?)')
    .bind(id,digest,'human',Date.now()).run();
  return json({id,token},201);
 }
 const visitor=await identity(request,env),isOwner=owner(request,env);
 if(method==='GET'&&path==='/api/messages')return json({messages:await readPosts(env,visitor,isOwner),limit:MAX_MESSAGES,pinLimit:MAX_PINS});
 // AI-only write endpoints authenticate via a separate secret; never expose deletion or pin controls.
 if(method==='POST'&&path==='/api/ai/messages'){
  if(!aiWriter(request,env))return json({error:'AI write key required.'},403);
  const data=await body(request);
  if(!validateBody(data?.text))return json({error:'Message must contain 1–300 words.'},400);
  const authorId='ai-agent',display='Camp AI';
  if(!await rateLimit(env,authorId,'posts',5,3600000))return json({error:'Posting too frequently.'},429);
  return json(await createPost(env,authorId,display,data.text),201);
 }
 if(method==='POST'&&path==='/api/messages'){
  if(!visitor)return json({error:'Visitor session required.'},401);
  const data=await body(request);
  if(!validateBody(data?.text))return json({error:'Message must contain 1–300 words.'},400);
  if(!await rateLimit(env,visitor.id,'posts',5,3600000))return json({error:'Maximum 5 posts per hour.'},429);
  return json(await createPost(env,visitor.id,nameOf(data.name),data.text),201);
 }
 const match=path.match(/^\/api\/messages\/([0-9a-f-]{36})(?:\/(like|comments|pin))?$/i);
 if(!match)return json({error:'Not found'},404);
 const postId=match[1],action=match[2]||'';
 if(method==='DELETE'&&!action){
  if(!visitor&&!isOwner)return json({error:'Only the creator or the owner can delete.'},403);
  const post=await env.DB.prepare('SELECT author_id FROM posts WHERE id=?').bind(postId).first();
  if(!post)return json({error:'Message expired or not found.'},404);
  if(!isOwner&&post.author_id!==visitor?.id)return json({error:'Only the creator or the owner can delete.'},403);
  await env.DB.prepare('DELETE FROM posts WHERE id=?').bind(postId).run();
  return json({ok:true});
 }
 if(method==='PATCH'&&action==='pin'){
  if(!isOwner)return json({error:'Only the owner may pin messages.'},403);
  const data=await body(request);
  if(typeof data?.pinned!=='boolean')return json({error:'Supply pinned: true or false.'},400);
  if(data.pinned){
   const r=await env.DB.prepare('UPDATE posts SET pinned=1 WHERE id=? AND pinned=0 AND (SELECT COUNT(*) FROM posts WHERE pinned=1)<3').bind(postId).run();
   if(!r.meta.changes)return json({error:'Message missing, already pinned, or maximum 3 pins reached.'},409);
  }else{
   const r=await env.DB.prepare('UPDATE posts SET pinned=0 WHERE id=?').bind(postId).run();
   if(!r.meta.changes)return json({error:'Message not found.'},404);
  }
  return json({ok:true});
 }
 if(method==='POST'&&action==='like'){
  if(!visitor)return json({error:'Visitor session required.'},401);
  const exists=await env.DB.prepare('SELECT id FROM posts WHERE id=?').bind(postId).first();
  if(!exists)return json({error:'Message expired or not found.'},404);
  const existing=await env.DB.prepare('SELECT visitor_id FROM likes WHERE post_id=? AND visitor_id=?').bind(postId,visitor.id).first();
  if(existing)await env.DB.prepare('DELETE FROM likes WHERE post_id=? AND visitor_id=?').bind(postId,visitor.id).run();
  else await env.DB.prepare('INSERT OR IGNORE INTO likes(post_id,visitor_id) VALUES(?,?)').bind(postId,visitor.id).run();
  return json({liked:!existing});
 }
 if(method==='POST'&&action==='comments'){
  if(!visitor)return json({error:'Visitor session required.'},401);
  const data=await body(request);
  if(!validateBody(data?.text))return json({error:'Comments must contain 1–300 words.'},400);
  if(!await rateLimit(env,visitor.id,'comments',25,3600000))return json({error:'Too many comments this hour.'},429);
  return await createComment(env,postId,visitor.id,nameOf(data.name),data.text);
 }
 return json({error:'Not found'},404);
}
export default {
 async fetch(request,env){
  const origin=request.headers.get('Origin')||'';
  const allowed=env.ALLOWED_ORIGIN||'https://mydecisionsmyworld.github.io';
  const headers={'Access-Control-Allow-Origin':allowed,'Vary':'Origin','Access-Control-Allow-Headers':'Content-Type,Authorization,X-Owner-Key,X-AI-Key','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS','Cache-Control':'no-store'};
  if(origin&&origin!==allowed)return json({error:'Origin not allowed.'},403,headers);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  try{
   if(!env.DB)return json({error:'D1 database is not configured.'},503,headers);
   const r=await handle(request,env);
   const h=new Headers(r.headers);for(const [k,v] of Object.entries(headers))h.set(k,v);
   return new Response(r.body,{status:r.status,headers:h});
  }catch(e){
   console.error('Board backend error',e);
   return json({error:'Board service error.'},500,headers);
  }
 }
};
