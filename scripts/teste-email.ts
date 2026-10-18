import 'dotenv/config';
import { enviarEmail } from '../src/lib/email';

// Uso: npm run teste:email -- destino@exemplo.com
const destino = process.argv[2];
if (!destino) throw new Error('Informe o destinatario: npm run teste:email -- voce@exemplo.com');

enviarEmail(destino, 'Teste Subloc_Consultorio', '<p>Se você leu isto, o Resend está funcionando.</p>')
  .then(() => console.log(`Enviado para ${destino}`))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
