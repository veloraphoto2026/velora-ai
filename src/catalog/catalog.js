"use strict";
// Catalog is deliberately disabled until model IDs and pricing are verified.
// Do not trust a client-provided price or provider model identifier.
const catalog = Object.freeze([]);
function listModels(){ return catalog.map(({id,title,modality,priceKopecks})=>({id,title,modality,priceKopecks})); }
function getModel(id){ return catalog.find(item=>item.id===id) || null; }
module.exports={listModels,getModel};
