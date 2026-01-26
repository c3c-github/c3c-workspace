public with sharing class ApuracaoCustosBatch implements Database.Batchable<sObject>, Database.Stateful {
    
    // Conjunto de IDs de Serviços e Alocações afetados para recalcular totais no finish
    private Set<Id> serviceIds = new Set<Id>();
    private Set<Id> allocationIds = new Set<Id>();

    public Database.QueryLocator start(Database.BatchableContext BC) {
        return Database.getQueryLocator([
            SELECT Id, Servico__c, Responsavel__c, Responsavel__r.Alocacao__c, 
                   DiaPeriodo__c, DiaPeriodo__r.Data__c, 
                   ValorTotalLancamento__c, Horas__c, HorasExtras__c 
            FROM LancamentoHora__c 
            WHERE Status__c = 'Faturado' 
            AND OrcamentoCompetencia__c = null
            AND Responsavel__r.Alocacao__c != null
        ]);
    }

    public void execute(Database.BatchableContext BC, List<LancamentoHora__c> scope) {
        Map<String, List<LancamentoHora__c>> agrupamento = new Map<String, List<LancamentoHora__c>>();
        
        for (LancamentoHora__c lh : scope) {
            Date dt = (lh.DiaPeriodo__r != null) ? lh.DiaPeriodo__r.Data__c : null;
            if (dt == null) continue;
            
            Date dataCompetencia = dt.toStartOfMonth();
            Id allocId = lh.Responsavel__r.Alocacao__c;
            String key = allocId + '_' + String.valueOf(dataCompetencia);
            
            if (!agrupamento.containsKey(key)) {
                agrupamento.put(key, new List<LancamentoHora__c>());
            }
            agrupamento.get(key).add(lh);
            
            serviceIds.add(lh.Servico__c);
            allocationIds.add(allocId);
        }

        if (agrupamento.isEmpty()) return;

        Map<String, OrcamentoCompetencia__c> orcMap = new Map<String, OrcamentoCompetencia__c>();
        for (OrcamentoCompetencia__c orc : [
            SELECT Id, Alocacao__c, Competencia__c 
            FROM OrcamentoCompetencia__c 
            WHERE Alocacao__c IN :allocationIds
        ]) {
            String key = orc.Alocacao__c + '_' + String.valueOf(orc.Competencia__c);
            orcMap.put(key, orc);
        }

        List<OrcamentoCompetencia__c> newOrcs = new List<OrcamentoCompetencia__c>();
        for (String key : agrupamento.keySet()) {
            if (!orcMap.containsKey(key)) {
                String[] parts = key.split('_');
                Id aId = (Id)parts[0];
                Date cDate = Date.valueOf(parts[1]);
                Id sId = agrupamento.get(key)[0].Servico__c;

                newOrcs.add(new OrcamentoCompetencia__c(
                    Alocacao__c = aId,
                    Servico__c = sId,
                    Competencia__c = cDate,
                    ReceitaPrevista__c = 0,
                    CustoPrevisto__c = 0,
                    CustoRealizado__c = 0,
                    HorasRealizadas__c = 0
                ));
            }
        }
        if (!newOrcs.isEmpty()) {
            insert newOrcs;
            for (OrcamentoCompetencia__c orc : newOrcs) {
                orcMap.put(orc.Alocacao__c + '_' + String.valueOf(orc.Competencia__c), orc);
            }
        }

        List<LancamentoHora__c> lhToUpdate = new List<LancamentoHora__c>();
        Map<Id, Decimal> deltaCusto = new Map<Id, Decimal>();
        Map<Id, Decimal> deltaHoras = new Map<Id, Decimal>();

        for (String key : agrupamento.keySet()) {
            OrcamentoCompetencia__c orc = orcMap.get(key);
            if (orc == null) continue;

            Decimal custoTotal = 0;
            Decimal horasTotal = 0;

            for (LancamentoHora__c lh : agrupamento.get(key)) {
                lh.OrcamentoCompetencia__c = orc.Id;
                lhToUpdate.add(lh);
                
                custoTotal += (lh.ValorTotalLancamento__c != null ? lh.ValorTotalLancamento__c : 0);
                horasTotal += (lh.Horas__c != null ? lh.Horas__c : 0) + (2 * (lh.HorasExtras__c != null ? lh.HorasExtras__c : 0));
            }

            deltaCusto.put(orc.Id, custoTotal);
            deltaHoras.put(orc.Id, horasTotal);
        }

        if (!lhToUpdate.isEmpty()) update lhToUpdate;
        
        List<OrcamentoCompetencia__c> finalOrcUpdates = new List<OrcamentoCompetencia__c>();
        for (OrcamentoCompetencia__c dbOrc : [SELECT Id, CustoRealizado__c, HorasRealizadas__c FROM OrcamentoCompetencia__c WHERE Id IN :deltaCusto.keySet()]) {
            dbOrc.CustoRealizado__c = (dbOrc.CustoRealizado__c != null ? dbOrc.CustoRealizado__c : 0) + deltaCusto.get(dbOrc.Id);
            dbOrc.HorasRealizadas__c = (dbOrc.HorasRealizadas__c != null ? dbOrc.HorasRealizadas__c : 0) + deltaHoras.get(dbOrc.Id);
            finalOrcUpdates.add(dbOrc);
        }
        if (!finalOrcUpdates.isEmpty()) update finalOrcUpdates;
    }

    public void finish(Database.BatchableContext BC) {
        if (!allocationIds.isEmpty()) {
            recalculateTotals();
        }
        System.debug('Apuração de Custos finalizada.');
    }

    private void recalculateTotals() {
        // 1. Totalizar Orçamentos -> Alocação
        List<Alocacao__c> allocsToUpdate = new List<Alocacao__c>();
        for (AggregateResult ar : [
            SELECT Alocacao__c id, SUM(CustoRealizado__c) total 
            FROM OrcamentoCompetencia__c 
            WHERE Alocacao__c IN :allocationIds 
            GROUP BY Alocacao__c
        ]) {
            allocsToUpdate.add(new Alocacao__c(
                Id = (Id)ar.get('id'),
                CustoRealizado__c = (Decimal)ar.get('total')
            ));
        }
        if (!allocsToUpdate.isEmpty()) update allocsToUpdate;

        // 2. Totalizar Alocações -> Serviço
        List<Servico__c> svcsToUpdate = new List<Servico__c>();
        
        // Buscar informações de receita de todos os serviços de uma vez
        Map<Id, Servico__c> sMap = new Map<Id, Servico__c>([
            SELECT Id, ReceitaRealizada__c FROM Servico__c WHERE Id IN :serviceIds
        ]);

        for (AggregateResult ar : [
            SELECT Servico__c id, SUM(CustoRealizado__c) total 
            FROM Alocacao__c 
            WHERE Servico__c IN :serviceIds 
            GROUP BY Servico__c
        ]) {
            Id sid = (Id)ar.get('id');
            Decimal custReal = (Decimal)ar.get('total');
            
            Decimal recReal = sMap.containsKey(sid) && sMap.get(sid).ReceitaRealizada__c != null ? 
                              sMap.get(sid).ReceitaRealizada__c : 0;
            
            Decimal margReal = 0;
            if (recReal > 0) {
                margReal = ((recReal - custReal) / recReal) * 100;
            }

            svcsToUpdate.add(new Servico__c(
                Id = sid,
                CustoRealizado__c = custReal,
                MargemRealizada__c = margReal
            ));
        }
        if (!svcsToUpdate.isEmpty()) update svcsToUpdate;
    }
}