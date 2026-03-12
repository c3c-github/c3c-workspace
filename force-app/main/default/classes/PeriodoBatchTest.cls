@isTest
private class PeriodoBatchTest {

    @isTest static void testBatchPeriodo() {

        Estado__c estado = new Estado__c(Name='São Paulo', Sigla__c = 'SP');
        insert estado;
        
        Municipio__c municipio = new Municipio__c (Name='São Paulo', Estado__c = estado.Id);
        insert municipio;
        
        // Criar Pessoa__c
        Pessoa__c pessoa = new Pessoa__c(Name = 'João da Silva', Municipio__c = municipio.Id);
        insert pessoa;

        // Criar Contratos (dois, sendo um mais recente)
        ContratoPessoa__c contrato1 = new ContratoPessoa__c(
            Pessoa__c = pessoa.Id,
            DataInicio__c = Date.newInstance(2025, 1, 10),
            ValorHora__c = 10,
            Hora__c = 6
        );
        ContratoPessoa__c contrato2 = new ContratoPessoa__c(
            Pessoa__c = pessoa.Id,
            DataInicio__c = Date.newInstance(2025, 6, 5),
            ValorHora__c = 10,
            Hora__c = 8
        );
        insert new List<ContratoPessoa__c>{contrato1, contrato2};

        // Criar configuração padrão na hierarquia (Configuração Padrão da Org)
        // Para testes, insira um registro ConfiguracaoPeriodo__c com DiaInicioPeriodo__c = 11
        // Use insert ou upsert (se existir)
        ConfiguracaoPeriodo__c config = new ConfiguracaoPeriodo__c(
            DiaInicioPeriodo__c = 11
        );
        upsert config;

        // Mockar hoje para ser 09/06/2025 - como não dá para alterar Date.today(), vamos assumir hoje = sistema

        Test.startTest();

        // Executar o batch
        PeriodoBatch batch = new PeriodoBatch();
        Database.executeBatch(batch);

        Test.stopTest();

        // Validar que foi criado um Periodo__c para o contrato mais recente (contrato2)
        List<Periodo__c> periodos = [SELECT Id, ContratoPessoa__c, DataInicio__c, DataFim__c, Name FROM Periodo__c WHERE ContratoPessoa__c = :contrato2.Id];

        System.assertEquals(1, periodos.size(), 'Deve ter criado 1 período para o contrato mais recente.');

        Periodo__c periodo = periodos[0];

        // Validar DataInicio conforme configuração (DiaInicioPeriodo = 11, mês e ano atuais)
        Date hoje = Date.today();
        Integer diaInicio = integer.valueOf(config.DiaInicioPeriodo__c);
        Integer ano = hoje.year();
        Integer mes = hoje.month();

        Date expectedDataInicio = Date.newInstance(ano, mes, diaInicio);

        System.assertEquals(expectedDataInicio, periodo.DataInicio__c, 'DataInicio deve ser o dia configurado no mês atual.');

        // Validar DataFim = 1 dia antes do próximo período
        Date expectedDataFim = expectedDataInicio.addMonths(1).addDays(-1);
        System.assertEquals(expectedDataFim, periodo.DataFim__c, 'DataFim deve ser o dia anterior ao próximo período.');

        // Validar Nome: "MêsPorExtenso Ano - NomePessoa"
        String nomeMes = Util.getNomeMesPtBr(expectedDataInicio);
        String expectedName = nomeMes + ' ' + String.valueOf(ano) + ' - ' + pessoa.Name;

        System.assertEquals(expectedName, periodo.Name, 'Nome do período deve estar no formato correto.');
    }

    @isTest static void testHolidayOverVacationPriority() {
        // Setup - Holiday on a specific date
        Date testDate = Date.newInstance(2025, 12, 25);
        
        // Find default Business Hours
        BusinessHours bh = [SELECT Id FROM BusinessHours WHERE IsDefault = true LIMIT 1];

        Holiday h = new Holiday(
            Name = 'Natal Teste Prioridade',
            ActivityDate = testDate
        );
        insert h;

        // Note: In some orgs, the relationship between Holiday and BusinessHours 
        // is automatic if the holiday is global. If it requires explicit link, 
        // we'd insert BusinessHoursHoliday, but it's a restricted object in many contexts.
        // The isWithin check will naturally return false for global holidays.

        // Base data
        Estado__c estado = new Estado__c(Name='São Paulo Priority', Sigla__c = 'SP');
        insert estado;
        
        Municipio__c municipio = new Municipio__c (Name='São Paulo Priority', Estado__c = estado.Id);
        insert municipio;

        Pessoa__c p = new Pessoa__c(Name = 'Teste Priority', Municipio__c = municipio.Id);
        insert p;

        ContratoPessoa__c cp = new ContratoPessoa__c(
            Pessoa__c = p.Id,
            DataInicio__c = testDate.addMonths(-1),
            ValorHora__c = 100,
            Hora__c = 8
        );
        insert cp;

        // Vacation (Agendada) on the same date
        Ferias__c f = new Ferias__c(
            Pessoa__c = p.Id,
            DataInicio__c = testDate,
            DataFim__c = testDate,
            Status__c = 'Agendada'
        );
        insert f;

        Test.startTest();
        // Create Period covering the date
        Periodo__c per = new Periodo__c(
            ContratoPessoa__c = cp.Id,
            DataInicio__c = testDate.toStartOfMonth(),
            DataFim__c = testDate.toStartOfMonth().addMonths(1).addDays(-1)
        );
        insert per;
        Test.stopTest();

        // Verify DiaPeriodo for that date
        DiaPeriodo__c dp = [SELECT Tipo__c, Name FROM DiaPeriodo__c WHERE Periodo__c = :per.Id AND Data__c = :testDate LIMIT 1];
        
        // Should be Feriado, not Férias
        System.assertEquals('Feriado', dp.Tipo__c, 'Holidays should have higher priority than vacations.');
        System.assert(dp.Name.contains('(Feriado)'), 'Name should indicate it is a holiday.');
    }
}