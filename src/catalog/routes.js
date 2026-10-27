"use strict";
const express = require("express");
const {listModels} = require("./catalog");
const router = express.Router();
router.get("/models", (_req,res)=>res.json({success:true,models:listModels(),paymentsEnabled:false}));
module.exports=router;
