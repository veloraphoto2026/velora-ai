"use strict";
// Called while the payment order row is locked with SELECT ... FOR UPDATE.
// Only the first valid callback can transition created -> paid and award credits.
function paymentAction(status){
 if(status==="created")return "credit";
 if(status==="paid")return "acknowledge";
 return "reject";
}
module.exports={paymentAction};
