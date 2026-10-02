import { EmailLinkConfirmation } from '../../components/email-link-confirmation';

export const metadata = { title:'Acceso por correo · The Backyard',robots:{index:false,follow:false},referrer:'no-referrer' as const };
export default function EmailConfirmPage(){return <EmailLinkConfirmation />;}
