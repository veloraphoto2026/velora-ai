const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "replicate") {
    return class FakeReplicate {
      async run() {
        if (process.env.VELORA_MOCK_REPLICATE === "fail") {
          throw new Error("Simulated Replicate failure");
        }
        return ["https://example.test/velora-mock-image.jpg"];
      }
    };
  }
  return originalLoad.apply(this, arguments);
};
