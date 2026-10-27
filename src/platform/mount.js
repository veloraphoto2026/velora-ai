"use strict";
// Mount read-only paid-platform routes into an existing Express app.
// This module intentionally does NOT enable purchases or provider calls.
const {createAccountRouter}=require("../account/routes");
const catalogRouter=require("../catalog/routes");
function mountPaidPlatform(app,{pool,authenticate}) {
  if(!app || typeof app.use!=="function") throw new Error("Express app required");
  app.use("/api/platform",catalogRouter);
  app.use("/api/platform",createAccountRouter({pool,authenticate}));
}
module.exports={mountPaidPlatform};
