public class PeriodoHandler {

    // CONTROLE DE RECURSÃO: 
    // Armazena os IDs que já tiveram seus dias calculados nesta transação.
    // Isso impede que a atualização automática dos campos de Roll-up (Horas__c, etc.) dispare a lógica novamente.
    private static Set<Id> periodosProcessados = new Set<Id>();

    // CACHE DE QUERY:
    // Armazena o ID do BusinessHours para não consultar o banco repetidamente.
    private static Id defaultBusinessHoursId;

    public static void gerenciarDiasPeriodo(List<Periodo__c> periodos) {
        
        // Lista para armazenar apenas os registros que realmente precisam ser processados (ainda não foram tocados)
        List<Periodo__c> periodosParaProcessar = new List<Periodo__c>();

        for (Periodo__c p : periodos) {
            // Se o ID já está no Set, significa que já processamos ele nesta transação (foi o gatilho de volta do Roll-up)
            // Então pulamos para economizar limite de query e CPU.
            if (periodosProcessados.contains(p.Id)) {
                continue;
            }

            // Validação básica para processar
            if (p.DataInicio__c != null && p.DataFim__c != null) {
                periodosParaProcessar.add(p);
                
                // Marca imediatamente como processado para bloquear futuras chamadas na mesma transação
                periodosProcessados.add(p.Id);
            }
        }

        // SE TODOS OS REGISTROS JÁ FORAM PROCESSADOS, RETORNA IMEDIATAMENTE.
        // É aqui que evitamos o erro "Too many SOQL queries".
        if (periodosParaProcessar.isEmpty()) {
            return;
        }

        // --- INÍCIO DA LÓGICA ORIGINAL (usando a lista filtrada) ---

        Set<Id> periodoIds = new Set<Id>();
        Map<Id, Periodo__c> periodoById = new Map<Id, Periodo__c>();
        Set<Id> estadoIds = new Set<Id>();
        Set<Id> municipioIds = new Set<Id>();
        Set<Id> pessoaIds = new Set<Id>();
        Date dataInicio;
        Date dataFim;

        // Iteramos sobre a lista FILTRADA
        for (Periodo__c p : periodosParaProcessar) {
            periodoIds.add(p.Id);
            periodoById.put(p.Id, p);
            estadoIds.add(p.Estado__c);
            municipioIds.add(p.Municipio__c);
            pessoaIds.add(p.Pessoa__c);
            
            if(dataInicio == null || p.DataInicio__c < dataInicio) 
                dataInicio = p.DataInicio__c;
            if(dataFim == null || p.DataFim__c > dataFim)
                dataFim = p.DataFim__c;
        }

        Map<String, Boolean> feriadosRegionais = Util.verificarFeriadosRegionais(estadoIds, municipioIds, dataInicio, dataFim);
        Map<String, Boolean> mapearDiasDeFeriasPorPessoa = Util.mapearDiasDeFeriasPorPessoa(pessoaIds, dataInicio, dataFim);

        List<DiaPeriodo__c> novosDias = new List<DiaPeriodo__c>();

        // OTIMIZAÇÃO: Busca Business Hours apenas se a variável estática estiver vazia
        if (defaultBusinessHoursId == null) {
            List<BusinessHours> bhList = [SELECT Id FROM BusinessHours WHERE IsDefault = true LIMIT 1];
            if (!bhList.isEmpty()) {
                defaultBusinessHoursId = bhList[0].Id;
            }
        }

        for (Periodo__c periodo : periodoById.values()) {
            Date dataAtual = periodo.DataInicio__c;

            while (dataAtual <= periodo.DataFim__c) {
                String diaFormatado = (dataAtual.day() < 10 ? '0' : '') + String.valueOf(dataAtual.day());
                String mesFormatado = (dataAtual.month() < 10 ? '0' : '') + String.valueOf(dataAtual.month());

                String nomeDiaSemana = Util.getNomeDiaSemanaPtBr(dataAtual);
                String tipo;
                DateTime dataHora = DateTime.newInstance(dataAtual, Time.newInstance(12, 0, 0, 0));

                if(feriadosRegionais.containsKey(periodo.Estado__c + '-' + dataAtual.format())) {
                    tipo = 'Feriado';
                } else if (feriadosRegionais.containsKey(periodo.Municipio__c + '-' + dataAtual.format())) {
                    tipo = 'Feriado';
                } else if(mapearDiasDeFeriasPorPessoa.containsKey(periodo.Pessoa__c + '-' + dataAtual.format())) {
                    tipo = 'Férias';
                } else if (defaultBusinessHoursId != null && BusinessHours.isWithin(defaultBusinessHoursId, dataHora)) {
                    tipo = 'Útil';
                } else {
                    tipo = Util.verificarFeriado(dataAtual) ? 'Feriado' : 'Não Útil';
                }

                DiaPeriodo__c dia = new DiaPeriodo__c(
                    Periodo__c = periodo.Id,
                    Name = diaFormatado + '/' + mesFormatado + ' - ' + nomeDiaSemana + (tipo == 'Férias' ? ' (Férias)' : (tipo == 'Feriado' ? ' (Feriado)' : '')),
                    Data__c = dataAtual,
                    Tipo__c = tipo != 'Férias' ? tipo : nomeDiaSemana == 'Sábado' || nomeDiaSemana == 'Domingo' ? 'Não Útil' : tipo,
                    IdExterno__c = periodo.Id + '-' + dataAtual.format()
                );
                novosDias.add(dia);
                dataAtual = dataAtual.addDays(1);
            }
        }

        if (!novosDias.isEmpty()) {
            upsert novosDias IdExterno__c;
        }
    }
}