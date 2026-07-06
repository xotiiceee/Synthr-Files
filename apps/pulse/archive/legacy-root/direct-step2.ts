import { assembleChatIntelContext } from './src/intelligence/chat-intel-context.js';
import { runIntelResearch, runGoalDecompose } from './src/intelligence/intel-primitives.js';
import { upsertKnowledgeToGateway } from './src/core/knowledge-store.js';
(async () => {
  upsertKnowledgeToGateway([{id:'s2',source:'s',content:'step2 verif query x402 github knowledge live direct call from app',metadata:{brand_id:'tenant-verif-42'}}]);
  const p1=runGoalDecompose({goal:'step2 direct decompose verif from app',brandId:'tenant-verif-42',paidCostUsd:0.0005});
  console.log('STEP2-DECOMP cost='+p1.meta.data_cost_usdc+' steps='+p1.result.steps.length+' trace='+p1.meta.decision_trace);
  const p2=await runIntelResearch({query:'step2 verif query x402 live',brandId:'tenant-verif-42',paidCostUsd:0.001});
  console.log('STEP2-RESEARCH cost='+p2.meta.data_cost_usdc+' trace='+p2.meta.decision_trace+' kbLen='+(p2.result.knowledgeBlock||'').length);
  const c=await assembleChatIntelContext('tenant-verif-42','step2 verif query x402 live');
  console.log('STEP2-ASSEMBLE kbLen='+(c.knowledgeBlock||'').length+' ghLen='+(c.ghBlock||'').length+' xLen='+(c.xIntelBlock||'').length+' costNum='+(c.knowledgeMeta?.data_cost_usdc || c.xIntelMeta?.data_cost_usdc || 0));
})();
