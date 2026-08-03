"use strict";

const contractManifest = require("../../../config/cross-domain-contracts.json");

function majorOf(version) {
  const match = String(version || "").match(/^(\d+)\.\d+\.\d+$/);
  if (!match) throw new TypeError(`invalid semantic version: ${version}`);
  return Number(match[1]);
}

function validateContractManifest(manifest = contractManifest) {
  const contracts = manifest?.contracts;
  if (!Array.isArray(contracts) || contracts.length === 0) {
    throw new TypeError("contract manifest requires contracts");
  }
  const ids = new Set();
  for (const contract of contracts) {
    if (!/^[a-z][a-z0-9-]+\.v\d+$/.test(contract.id)) {
      throw new TypeError(`invalid contract id: ${contract.id}`);
    }
    if (ids.has(contract.id)) throw new TypeError(`duplicate contract: ${contract.id}`);
    ids.add(contract.id);
    const idMajor = Number(contract.id.match(/\.v(\d+)$/)[1]);
    if (majorOf(contract.version) !== idMajor) {
      throw new TypeError(`contract ${contract.id} version does not match its major id`);
    }
    if (!contract.owner || !Array.isArray(contract.consumers) || contract.consumers.length === 0) {
      throw new TypeError(`contract ${contract.id} requires owner and consumers`);
    }
    if (!Array.isArray(contract.requiredFields) || contract.requiredFields.length === 0) {
      throw new TypeError(`contract ${contract.id} requires fields`);
    }
  }
  return true;
}

class ContractRegistry {
  constructor(manifest = contractManifest) {
    validateContractManifest(manifest);
    this.contracts = new Map(manifest.contracts.map((contract) => [
      contract.id,
      Object.freeze({ ...contract, consumers: Object.freeze([...contract.consumers]), requiredFields: Object.freeze([...contract.requiredFields]) })
    ]));
    this.adapters = new Map();
  }

  registerAntiCorruptionAdapter({ contractId, consumer, fromExternal, toExternal }) {
    const contract = this.get(contractId);
    if (!contract.consumers.includes(consumer)) {
      throw new Error(`${consumer} is not an authorized consumer of ${contractId}`);
    }
    if (typeof fromExternal !== "function" || typeof toExternal !== "function") {
      throw new TypeError("anti-corruption adapter requires fromExternal and toExternal");
    }
    this.adapters.set(`${contractId}:${consumer}`, Object.freeze({ fromExternal, toExternal }));
    return this;
  }

  get(contractId) {
    const contract = this.contracts.get(contractId);
    if (!contract) throw new TypeError(`unknown contract: ${contractId}`);
    return contract;
  }

  decode(contractId, consumer, payload) {
    const contract = this.get(contractId);
    if (!contract.consumers.includes(consumer)) {
      throw new Error(`${consumer} is not an authorized consumer of ${contractId}`);
    }
    const adapter = this.adapters.get(`${contractId}:${consumer}`);
    if (!adapter) throw new Error(`anti-corruption adapter missing for ${contractId}:${consumer}`);
    const value = adapter.fromExternal(structuredClone(payload));
    const missing = contract.requiredFields.filter((field) => value?.[field] === undefined);
    if (missing.length > 0) throw new TypeError(`${contractId} is missing: ${missing.join(", ")}`);
    return Object.freeze(value);
  }

  encode(contractId, consumer, value) {
    const adapter = this.adapters.get(`${contractId}:${consumer}`);
    if (!adapter) throw new Error(`anti-corruption adapter missing for ${contractId}:${consumer}`);
    return Object.freeze(adapter.toExternal(structuredClone(value)));
  }
}

module.exports = { ContractRegistry, majorOf, validateContractManifest };
