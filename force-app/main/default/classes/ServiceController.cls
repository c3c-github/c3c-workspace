public with sharing class ServiceController {
    
    @AuraEnabled(cacheable=true)
    public static Map<String, Object> getServiceDetails(String serviceId) {
        Map<String, Object> result = new Map<String, Object>();
        
        try {
            // 1. Buscar Serviço e Listas Relacionadas
            Servico__c svc = [
                SELECT Id, Name, Tipo__c, Conta__c, Conta__r.Name, 
                       Lider__c, Lider__r.Name, 
                       Coordenador__c, Coordenador__r.Name, 
                       LiderTecnico__c, LiderTecnico__r.Name,
                       DataInicio__c, DataFim__c,
                       (SELECT Id, Produto__c, TaxaVenda__c, CustoEstimado__c, DataInicio__c, DataFim__c, PercentualAlocacao__c 
                        FROM AlocacoesPrevistas__r),
                       (SELECT Id, Pessoa__c, Pessoa__r.Name, DataInicio__c, DataFim__c, Percentual__c 
                        FROM Alocacoes__r), // Verificar nome do relacionamento real
                       (SELECT Id, Descricao__c, DataVencimento__c, Valor__c, Status__c, Competencia__c 
                        FROM ParcelasFinanceiras__r)
                FROM Servico__c 
                WHERE Id = :serviceId
                LIMIT 1
            ];

            // 2. Mapeamento para o formato do Mock
            result.put('id', svc.Id);
            result.put('name', svc.Name);
            result.put('client', svc.Conta__r != null ? svc.Conta__r.Name : '');
            result.put('type', svc.Tipo__c);
            result.put('lead_project', svc.Lider__c);
            result.put('coordinator', svc.Coordenador__c);
            result.put('tech_lead', svc.LiderTecnico__c);

            // Comercial (Baseline)
            List<Map<String, Object>> commercial = new List<Map<String, Object>>();
            for(AlocacaoPrevista__c ap : svc.AlocacoesPrevistas__r) {
                Map<String, Object> item = new Map<String, Object>();
                item.put('id', ap.Id);
                item.put('productId', ap.Produto__c); // Se for ID
                item.put('productName', ap.Produto__c); // Se for Texto
                item.put('saleRate', ap.TaxaVenda__c);
                item.put('costEst', ap.CustoEstimado__c);
                item.put('start', ap.DataInicio__c);
                item.put('end', ap.DataFim__c);
                item.put('alloc', ap.PercentualAlocacao__c);
                commercial.add(item);
            }
            result.put('commercial', commercial);

            // Execução (Alocação)
            List<Map<String, Object>> execution = new List<Map<String, Object>>();
            // Precisamos buscar detalhes extras da pessoa (custo) se não estiverem na alocação
            // Por simplicidade inicial, vamos usar o que temos
            for(Alocacao__c al : svc.Alocacoes__r) {
                Map<String, Object> item = new Map<String, Object>();
                item.put('id', al.Id);
                item.put('person', al.Pessoa__r.Name);
                item.put('personId', al.Pessoa__c);
                // item.put('costReal', ...); // Precisa vir da Pessoa ou Tabela de Custo
                // item.put('saleApplied', ...); // Precisa de lógica de vínculo
                item.put('start', al.DataInicio__c);
                item.put('end', al.DataFim__c);
                item.put('alloc', al.Percentual__c);
                execution.add(item);
            }
            result.put('execution', execution);

            // Faturamento (Billing)
            List<Map<String, Object>> billing = new List<Map<String, Object>>();
            for(ParcelaFinanceira__c pf : svc.ParcelasFinanceiras__r) {
                Map<String, Object> item = new Map<String, Object>();
                item.put('id', pf.Id);
                item.put('desc', pf.Descricao__c);
                item.put('date', pf.DataVencimento__c);
                item.put('value', pf.Valor__c);
                item.put('month', pf.Competencia__c); // Formatar YYYY-MM
                billing.add(item);
            }
            result.put('installments', billing);

            // Metadados (Mockados por enquanto ou buscar de tabelas auxiliares)
            result.put('metadata', getMetadata());

        } catch (Exception e) {
            throw new AuraHandledException('Erro ao buscar serviço: ' + e.getMessage());
        }
        
        return result;
    }

    private static Map<String, Object> getMetadata() {
        // Retornar listas para dropdowns (Pessoas, Contas, Produtos)
        // Implementar queries reais aqui depois
        return new Map<String, Object>{
            'products' => new List<Object>(),
            'people' => new List<Object>()
        };
    }
}