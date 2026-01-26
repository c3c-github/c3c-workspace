public with sharing class ContaAzulSyncBatch implements Database.Batchable<sObject>, Database.AllowsCallouts, Database.Stateful {
    
    // Conjunto de situações que consideramos como pagamento confirmado
    private static final Set<String> STATUS_PAGO = new Set<String>{'QUITADO', 'PAGO', 'CONFIRMADO'};

    public Database.QueryLocator start(Database.BatchableContext BC) {
        // Busca parcelas que:
        // 1. Não estão pagas (precisam sincronizar com ERP)
        // 2. Já estão pagas mas ainda possuem saldo a distribuir para competências (Histórico ou Planejamento tardio)
        return Database.getQueryLocator([
            SELECT Id, Servico__c, Valor__c, Status__c, VendaContaAzul__r.IDEventoFinanceiro__c, SaldoAberto__c
            FROM ParcelaFinanceira__c 
            WHERE Status__c != 'Pago' 
            OR SaldoAberto__c > 0
        ]);
    }

    public void execute(Database.BatchableContext BC, List<ParcelaFinanceira__c> scope) {
        List<ParcelaFinanceira__c> parcelasParaAtualizar = new List<ParcelaFinanceira__c>();
        List<DistribuicaoReceita__c> distribuicoesParaCriar = new List<DistribuicaoReceita__c>();
        
        ContaAzulAuthService.AuthResult auth = ContaAzulAuthService.getAuthentication();
        String token = auth.accessToken;
        Configuracao__c configAtualizada = auth.configParaAtualizar;

        Set<Id> serviceIds = new Set<Id>();
        for (ParcelaFinanceira__c p : scope) serviceIds.add(p.Servico__c);
        
        Map<Id, List<OrcamentoCompetencia__c>> orcamentosPorServico = new Map<Id, List<OrcamentoCompetencia__c>>();
        for (OrcamentoCompetencia__c orc : [
            SELECT Id, Servico__c, ReceitaPrevista__c, ReceitaRealizada__c, SaldoReceita__c 
            FROM OrcamentoCompetencia__c 
            WHERE Servico__c IN :serviceIds 
            AND Alocacao__r.AlocacaoPrevista__c != null
            ORDER BY Competencia__c ASC, CreatedDate ASC
        ]) {
            if (!orcamentosPorServico.containsKey(orc.Servico__c)) {
                orcamentosPorServico.put(orc.Servico__c, new List<OrcamentoCompetencia__c>());
            }
            orcamentosPorServico.get(orc.Servico__c).add(orc);
        }

        Map<Id, Decimal> saldoVirtualOrcamento = new Map<Id, Decimal>();

        for (ParcelaFinanceira__c parc : scope) {
            try {
                Boolean isPaid = parc.Status__c == 'Pago';
                String eventId = parc.VendaContaAzul__r.IDEventoFinanceiro__c;

                // 1. Se não estiver paga, sincroniza com ERP
                if (!isPaid && String.isNotBlank(eventId)) {
                    String statusCA = fetchStatusFromContaAzul(eventId, token);
                    if (STATUS_PAGO.contains(statusCA.toUpperCase())) {
                        parc.Status__c = 'Pago';
                        isPaid = true;
                        parcelasParaAtualizar.add(parc);
                    }
                }

                // 2. Se estiver paga (já era ou virou agora), verifica distribuição
                if (isPaid && parc.SaldoAberto__c > 0) {
                    Decimal valorParaDistribuir = parc.SaldoAberto__c;
                    List<OrcamentoCompetencia__c> orcamentos = orcamentosPorServico.get(parc.Servico__c);

                    if (orcamentos != null) {
                        for (OrcamentoCompetencia__c orc : orcamentos) {
                            if (valorParaDistribuir <= 0) break;

                            Decimal saldoAtual = saldoVirtualOrcamento.containsKey(orc.Id) ? 
                                                 saldoVirtualOrcamento.get(orc.Id) : orc.SaldoReceita__c;

                            if (saldoAtual > 0) {
                                Decimal valorAlocado = Math.min(valorParaDistribuir, saldoAtual);
                                
                                distribuicoesParaCriar.add(new DistribuicaoReceita__c(
                                    ParcelaFinanceira__c = parc.Id,
                                    OrcamentoCompetencia__c = orc.Id,
                                    ValorDistribuido__c = valorAlocado
                                ));

                                valorParaDistribuir -= valorAlocado;
                                saldoVirtualOrcamento.put(orc.Id, saldoAtual - valorAlocado);
                            }
                        }
                    }
                }
            } catch (Exception e) {
                System.debug('Erro ao processar parcela ' + parc.Id + ': ' + e.getMessage());
            }
        }

        // DMLs
        if (!distribuicoesParaCriar.isEmpty()) insert distribuicoesParaCriar;
        if (!parcelasParaAtualizar.isEmpty()) update parcelasParaAtualizar;
        if (configAtualizada != null) update configAtualizada;

        // 3. Recalcular Receita Realizada no Serviço
        if (!serviceIds.isEmpty()) {
            List<Servico__c> servicosParaAtualizar = new List<Servico__c>();
            
            // Buscar custos atuais para cálculo da margem em Apex
            Map<Id, Servico__c> currentServicos = new Map<Id, Servico__c>([
                SELECT Id, CustoRealizado__c FROM Servico__c WHERE Id IN :serviceIds
            ]);

            // Agrega toda a receita distribuída para estes serviços
            for (AggregateResult ar : [
                SELECT ParcelaFinanceira__r.Servico__c svcId, SUM(ValorDistribuido__c) total 
                FROM DistribuicaoReceita__c 
                WHERE ParcelaFinanceira__r.Servico__c IN :serviceIds 
                GROUP BY ParcelaFinanceira__r.Servico__c
            ]) {
                Id sid = (Id)ar.get('svcId');
                Decimal recReal = (Decimal)ar.get('total');
                Decimal custReal = currentServicos.get(sid).CustoRealizado__c != null ? currentServicos.get(sid).CustoRealizado__c : 0;
                
                Decimal margReal = 0;
                if (recReal > 0) {
                    margReal = ((recReal - custReal) / recReal) * 100;
                }

                servicosParaAtualizar.add(new Servico__c(
                    Id = sid,
                    ReceitaRealizada__c = recReal,
                    MargemRealizada__c = margReal
                ));
            }
            if (!servicosParaAtualizar.isEmpty()) update servicosParaAtualizar;
        }
    }

    private String fetchStatusFromContaAzul(String eventId, String token) {
        Http http = new Http();
        HttpRequest req = new HttpRequest();
        req.setEndpoint('https://api-v2.contaazul.com/v1/financeiro/eventos-financeiros/' + eventId + '/parcelas');
        req.setMethod('GET');
        req.setHeader('Authorization', 'Bearer ' + token);
        
        HttpResponse res = http.send(req);
        if (res.getStatusCode() == 200) {
            List<Object> parcelas = (List<Object>) JSON.deserializeUntyped(res.getBody());
            if (!parcelas.isEmpty()) {
                // Consideramos o status da primeira parcela encontrada (visto que tratamos 1 evento : 1 venda)
                // Se houver múltiplas, a lógica pode ser refinada.
                Map<String, Object> primeira = (Map<String, Object>) parcelas[0];
                return (String) primeira.get('status');
            }
        }
        return 'PENDENTE';
    }

    public void finish(Database.BatchableContext BC) {
        System.debug('Sincronização Conta Azul finalizada.');
    }
}