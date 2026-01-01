@isTest
public class ContactPhoneFormatTest {
    
    @isTest
    static void testTriggerDesativada() {
        // Cenário: Tenta inserir um contato com número que antes daria erro.
        // Como a trigger está comentada, o insert DEVE funcionar normalmente sem erros.
        
        Contact c = new Contact(
            LastName = 'Teste Trigger Desativada',
            MobilePhone = '11999998888' // Formato que antes falharia ou formataria
        );
        
        Test.startTest();
        
        // Testa Insert
        insert c;
        
        // Testa Update
        c.MobilePhone = '5511999997777';
        update c;
        
        Test.stopTest();
        
        // Verificação simples: O contato existe? Se sim, sucesso.
        Contact insertedC = [SELECT Id, MobilePhone FROM Contact WHERE Id = :c.Id LIMIT 1];
        System.assertNotEquals(null, insertedC.Id, 'O contato deveria ter sido salvo pois a trigger está desativada.');
    }
}