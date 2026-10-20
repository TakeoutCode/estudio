import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'estudio:public';

/** BE11: rutas sin access token. Todo lo demás exige uno. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
