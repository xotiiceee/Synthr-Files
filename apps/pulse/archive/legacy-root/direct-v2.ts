import { assembleChatIntelContext } from './src/intelligence/chat-intel-context.js';
import { runIntelResearch, runGoalDecompose } from './src/intelligence/intel-primitives.js';
import { upsertKnowledgeToGateway } from './src/core/knowledge-store.js';
(async () => {
  upsertKnowledgeToGateway([{id:'v2s',source:'s',content:'step2 verif x402 live github knowledge from app direct',metadata:{brand_id:'tenant-verif-42'}}]);
  const d1 = runGoalDecompose({goal:'step2 direct decompose verif plan',brandId:'tenant-verif-42',paidCostUsd:0.0005});
  console.log('STEP2-D1 cost='+d1.meta.data_cost_usdc+' steps='+d1.result.steps.length+' trace='+d1.meta.decision_trace+' desc0='+d1.result.steps[0].description);
  const r1=await runIntelResearch({query:'step2 verif x402 live',brandId:'tenant-verif-42',paidCostUsd:0.001});
  console.log('STEP2-R1 cost='+r1.meta.data_cost_usdc+' trace='+r1.meta.decision_trace+' kb='+ (r1.result.knowledgeBlock||'').length +' gh='+(r1.result.ghBlock||'').length);
  const c=await assembleChatIntelContext('tenant-verif-42','step2 verif x402 live');
  console.log('STEP2-C kb='+(c.knowledgeBlock||'').length+' gh='+(c.ghBlock||'').length+' x='+(c.xIntelBlock||'').length+' metaC='+(c.knowledgeMeta?.data_cost_usdc||c.xIntelMeta?.data_cost_usdc||0));
})();
