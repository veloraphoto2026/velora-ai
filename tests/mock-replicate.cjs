// Loaded only by the test child process. Never makes an external API call.
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "replicate") {
    return class OfflineReplicate {
      async run() {
        if (process.env.TEST_REPLICATE_FAIL === "true") {
          throw new Error("Simulated provider failure");
        }
        return "https://example.test/generated-image.jpg";
      }
    };
  }
  return originalLoad.apply(this, arguments);
};
