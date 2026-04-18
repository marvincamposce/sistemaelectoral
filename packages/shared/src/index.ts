if (typeof BigInt !== "undefined" && !("toJSON" in BigInt.prototype)) {
  Object.defineProperty(BigInt.prototype, "toJSON", {
    get() {
      return function (this: bigint) {
        return this.toString();
      };
    },
    configurable: true,
  });
}

export * from "./stateMachine.js";
export * from "./domain.js";
export * from "./presentacion.js";
