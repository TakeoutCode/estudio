import {
  type Card,
  cardIdFor,
  cardOrdinals,
  CardSchema,
  type Deck,
  DeckSchema,
  encodeHlc,
  newId,
  type Note,
  type NoteContent,
  NoteSchema,
  SERVER_NODE,
  type Topic,
  TopicSchema,
} from '@estudio/shared';

// Mazo de desarrollo con los 206 huesos del esqueleto adulto, un tema por región (LD5). Cada
// nota `basic` es un hueso o un grupo que se nombra junto (los pares cuentan 2, las falanges
// de una mano 14); las `cloze` piden cuántos hay. `bones-deck.spec.ts` comprueba la cuenta.

export type Skeleton = 'axial' | 'appendicular';

export interface BoneNote {
  /** Huesos que cubre la nota en la cuenta de 206. */
  readonly count: number;
  readonly content: NoteContent;
}

export interface TopicEntry {
  readonly name: string;
  /** null en el tema que no es una región. */
  readonly skeleton: Skeleton | null;
  readonly explanation: string;
  readonly bones: readonly BoneNote[];
  /** Notas que no son un hueso: los conteos de la región. */
  readonly counts: readonly NoteContent[];
}

const bone = (count: number, front: string, back: string, explanation: string): BoneNote => ({
  count,
  content: { kind: 'basic', front, back, explanation, reverse: false },
});

const basic = (front: string, back: string, explanation: string): NoteContent => ({
  kind: 'basic',
  front,
  back,
  explanation,
  reverse: false,
});

const cloze = (text: string, explanation: string): NoteContent => ({ kind: 'cloze', text, explanation });

export interface DeckEntry {
  readonly name: string;
  readonly description: string;
  readonly topics: readonly TopicEntry[];
}

export const BONES_DECK: DeckEntry = {
  name: 'Huesos del esqueleto',
  description:
    'Los 206 huesos del esqueleto adulto, por región. Cada tarjeta es un hueso o un grupo que se nombra junto (los pares cuentan una vez); las de conteo piden cuántos hay.',
  topics: [
    {
      name: 'Visión general',
      skeleton: null,
      explanation:
        'El esqueleto adulto tiene 206 huesos. Se divide en dos partes. El esqueleto axial es el eje del cuerpo: cráneo, huesecillos del oído, hioides, columna vertebral y tórax; suma 80. El apendicular son los miembros superiores e inferiores con las cinturas que los unen al tronco (escapular y pélvica); suma 126.\n\nAl nacer hay entre 270 y 300 piezas, que se fusionan al crecer: las 5 vértebras sacras forman el sacro y el ilion, el isquion y el pubis forman el coxal. La cuenta de 206 no incluye los huesos suturales, que varían entre personas, ni los sesamoideos, salvo las patelas y los pisiformes.',
      bones: [],
      counts: [
        cloze(
          'El esqueleto adulto tiene {{c1::206}} huesos: {{c2::80}} en el esqueleto axial y {{c3::126}} en el apendicular.',
          'Al nacer hay entre 270 y 300 piezas; muchas se fusionan al crecer.',
        ),
        basic(
          '¿Qué partes forman el esqueleto axial?',
          'Cráneo, huesecillos del oído, hioides, columna vertebral y tórax (esternón y costillas).',
          'El apendicular son los miembros superiores e inferiores con las cinturas escapular y pélvica.',
        ),
      ],
    },
    {
      name: 'Neurocráneo',
      skeleton: 'axial',
      explanation:
        'El neurocráneo es la caja que protege el encéfalo. Tiene 8 huesos: 4 impares (frontal, occipital, esfenoides y etmoides) y 2 pares (parietales y temporales).\n\nSe unen por suturas, articulaciones fibrosas casi inmóviles en el adulto: la coronal (frontal con parietales), la sagital (entre los parietales), la lambdoidea (parietales con occipital) y las escamosas (parietal con temporal). El esfenoides y el etmoides forman la base del cráneo en el centro y adelante.',
      bones: [
        bone(
          1,
          'Hueso impar que forma la frente y el techo de las órbitas.',
          'Frontal (impar, 1)',
          'Se une a los dos parietales por la sutura coronal. Dentro tiene los senos frontales.',
        ),
        bone(
          2,
          'Huesos pares que forman el techo y las paredes laterales del cráneo y se unen en la línea media.',
          'Parietales (par, 2)',
          'Se unen entre sí por la sutura sagital, con el frontal por la coronal y con el occipital por la lambdoidea.',
        ),
        bone(
          2,
          'Huesos pares de la pared lateral y la base del cráneo que alojan el oído medio y el interno.',
          'Temporales (par, 2)',
          'El oído está en su porción petrosa. Tienen las apófisis mastoides y estiloides, y se articulan con la mandíbula (articulación temporomandibular).',
        ),
        bone(
          1,
          'Hueso impar de la parte posterior e inferior del cráneo, con el agujero por el que pasa la médula espinal.',
          'Occipital (impar, 1)',
          'El agujero es el foramen magno. Sus cóndilos se articulan con el atlas (C1).',
        ),
        bone(
          1,
          'Hueso impar con forma de mariposa en el centro de la base del cráneo; su silla turca aloja la hipófisis.',
          'Esfenoides (impar, 1)',
          'Se articula con todos los demás huesos del neurocráneo. Tiene alas mayores, alas menores y apófisis pterigoides.',
        ),
        bone(
          1,
          'Hueso impar entre las órbitas cuya lámina cribosa deja pasar los nervios olfatorios.',
          'Etmoides (impar, 1)',
          'Su lámina perpendicular forma parte del tabique nasal, y los cornetes nasales superior y medio son parte de él.',
        ),
      ],
      counts: [cloze('El neurocráneo tiene {{c1::8}} huesos.', '4 impares y 2 pares.')],
    },
    {
      name: 'Viscerocráneo (cara)',
      skeleton: 'axial',
      explanation:
        'El viscerocráneo es el esqueleto de la cara: da forma al rostro y rodea la entrada de las vías digestiva y respiratoria. Tiene 14 huesos: 6 pares (maxilares, cigomáticos, nasales, lagrimales, palatinos y cornetes nasales inferiores) y 2 impares (vómer y mandíbula). Con el neurocráneo, el cráneo suma 22.\n\nLa mandíbula es la única que se articula de forma móvil, con los dos temporales. Algunos textos cuentan aquí el etmoides y el esfenoides; en este mazo van en el neurocráneo, como en la cuenta de 206.',
      bones: [
        bone(
          2,
          'Huesos pares que llevan los dientes superiores y forman parte del paladar duro, del piso de la órbita y de las paredes de la cavidad nasal.',
          'Maxilares (par, 2)',
          'Dentro tienen el seno maxilar, el más grande de los senos paranasales. Su apófisis palatina forma la parte anterior del paladar duro.',
        ),
        bone(
          2,
          'Huesos pares de los pómulos que forman parte de la pared lateral de la órbita.',
          'Cigomáticos o malares (par, 2)',
          'Con la apófisis cigomática del temporal forman el arco cigomático.',
        ),
        bone(
          2,
          'Huesos pares pequeños que forman el puente de la nariz.',
          'Nasales (par, 2)',
          'Se unen entre sí en la línea media y con el frontal arriba; el resto de la nariz externa es cartílago.',
        ),
        bone(
          2,
          'Huesos pares, los más pequeños de la cara, en la pared medial de la órbita junto al saco lagrimal.',
          'Lagrimales (par, 2)',
          'Con el maxilar forman la fosa del saco lagrimal, que drena las lágrimas hacia la nariz por el conducto nasolagrimal.',
        ),
        bone(
          2,
          'Huesos pares con forma de L que forman la parte posterior del paladar duro.',
          'Palatinos (par, 2)',
          'Su lámina horizontal completa el paladar duro detrás de los maxilares; la perpendicular forma parte de la pared lateral de la cavidad nasal.',
        ),
        bone(
          2,
          'Huesos pares enrollados en la pared lateral de la cavidad nasal; los únicos cornetes que son huesos independientes.',
          'Cornetes nasales inferiores (par, 2)',
          'Los cornetes superior y medio son parte del etmoides; por eso solo los inferiores cuentan aparte en los 206.',
        ),
        bone(
          1,
          'Hueso impar y delgado que forma la parte posterior e inferior del tabique nasal.',
          'Vómer (impar, 1)',
          'Arriba se une a la lámina perpendicular del etmoides; juntos forman el tabique nasal óseo.',
        ),
        bone(
          1,
          'Hueso impar con forma de herradura que lleva los dientes inferiores; el único móvil de la cara.',
          'Mandíbula o maxilar inferior (impar, 1)',
          'Se articula con los temporales en la articulación temporomandibular. Es el hueso más grande y fuerte de la cara.',
        ),
      ],
      counts: [
        cloze(
          'La cara tiene {{c1::14}} huesos; con el neurocráneo, el cráneo suma {{c2::22}}.',
          '6 pares y 2 impares en la cara, más los 8 del neurocráneo.',
        ),
      ],
    },
    {
      name: 'Huesecillos del oído e hioides',
      skeleton: 'axial',
      explanation:
        'Dentro de cada temporal, en el oído medio, hay una cadena de 3 huesecillos que lleva la vibración del tímpano al oído interno: martillo, yunque y estribo, en ese orden. Son 6 en total, 3 por oído, y son los huesos más pequeños del cuerpo.\n\nEl hioides está en el cuello, sobre la laringe. Es el único hueso que no se articula con ningún otro: lo sostienen músculos y ligamentos.',
      bones: [
        bone(
          2,
          'Primer huesecillo del oído medio, unido al tímpano.',
          'Martillo (par, 2)',
          'Recibe la vibración del tímpano y la pasa al yunque.',
        ),
        bone(
          2,
          'Huesecillo del medio en la cadena del oído medio.',
          'Yunque (par, 2)',
          'Une el martillo con el estribo.',
        ),
        bone(
          2,
          'Huesecillo que encaja en la ventana oval del oído interno; el hueso más pequeño del cuerpo.',
          'Estribo (par, 2)',
          'Su base (platina) mueve el líquido del oído interno a través de la ventana oval.',
        ),
        bone(
          1,
          'Hueso impar con forma de U en el cuello, sobre la laringe, que no se articula con ningún otro hueso.',
          'Hioides (impar, 1)',
          'Lo sostienen músculos y ligamentos, como el estilohioideo. Sirve de anclaje a la lengua y a los músculos que mueven la laringe al tragar.',
        ),
      ],
      counts: [
        cloze(
          'Los huesecillos del oído son {{c1::6}}: 3 en cada oído medio.',
          'Martillo, yunque y estribo en cada lado.',
        ),
      ],
    },
    {
      name: 'Columna vertebral',
      skeleton: 'axial',
      explanation:
        'La columna del adulto tiene 26 huesos: 7 vértebras cervicales, 12 torácicas, 5 lumbares, el sacro y el cóccix. El sacro son 5 vértebras sacras fusionadas y el cóccix, de 3 a 5 coccígeas fusionadas; por eso al nacer se cuentan más piezas.\n\nLas dos primeras cervicales tienen nombre propio: el atlas (C1) sostiene el cráneo y el axis (C2) le permite girar. Cada región tiene un rasgo que la distingue: las cervicales, agujeros en las apófisis transversas; las torácicas, carillas para las costillas; las lumbares, cuerpos grandes sin ninguno de los dos.',
      bones: [
        bone(
          1,
          'Primera vértebra cervical (C1): un anillo sin cuerpo vertebral que sostiene el cráneo.',
          'Atlas (C1, impar, 1)',
          'Se articula con los cóndilos del occipital; ese movimiento es el de asentir con la cabeza.',
        ),
        bone(
          1,
          'Segunda vértebra cervical (C2), con una apófisis vertical (el diente) sobre la que gira el atlas.',
          'Axis (C2, impar, 1)',
          'El diente o apófisis odontoides es el eje de la rotación de la cabeza, como al decir que no.',
        ),
        bone(
          5,
          'Vértebras del cuello de C3 a C7, con un agujero en cada apófisis transversa.',
          'Vértebras cervicales C3-C7 (5)',
          'Por esos agujeros transversos suben las arterias vertebrales (desde C6). Con el atlas y el axis suman 7 cervicales; C7, la vértebra prominente, se palpa en la base del cuello.',
        ),
        bone(
          12,
          'Vértebras que se articulan con las costillas.',
          'Vértebras torácicas o dorsales, T1-T12 (12)',
          'Tienen carillas para las costillas en el cuerpo y, de T1 a T10, en las apófisis transversas. Sus apófisis espinosas son largas y apuntan hacia abajo.',
        ),
        bone(
          5,
          'Vértebras de la parte baja de la espalda, las de cuerpo más grande, sin carillas costales ni agujeros transversos.',
          'Vértebras lumbares, L1-L5 (5)',
          'Cargan casi todo el peso del tronco. La médula termina cerca de L1-L2; por eso la punción lumbar se hace más abajo, entre L3 y L5.',
        ),
        bone(
          1,
          'Hueso triangular formado por 5 vértebras fusionadas, entre los dos coxales.',
          'Sacro (impar, 1)',
          'Se articula con los coxales en las articulaciones sacroilíacas, con L5 arriba y con el cóccix abajo.',
        ),
        bone(
          1,
          'Último hueso de la columna, formado por 3 a 5 vértebras pequeñas fusionadas.',
          'Cóccix (impar, 1)',
          'Es el vestigio de la cola; en él se insertan músculos y ligamentos del piso pélvico.',
        ),
      ],
      counts: [
        cloze(
          'La columna del adulto tiene {{c1::7}} vértebras cervicales, {{c2::12}} torácicas, {{c3::5}} lumbares, el sacro y el cóccix: {{c4::26}} huesos.',
          'El sacro y el cóccix son vértebras fusionadas que cuentan como un hueso cada uno.',
        ),
      ],
    },
    {
      name: 'Tórax',
      skeleton: 'axial',
      explanation:
        'La caja torácica protege el corazón y los pulmones y se mueve al respirar. Tiene 25 huesos: el esternón y 12 pares de costillas.\n\nTodas las costillas se articulan atrás con las vértebras torácicas. Se clasifican por cómo llegan al esternón: las verdaderas (1.ª a 7.ª) con su propio cartílago costal; las falsas (8.ª a 10.ª) a través del cartílago de la costilla de arriba; y las flotantes (11.ª y 12.ª) no llegan. Algunos textos llaman falsas a la 8.ª a 12.ª e incluyen ahí a las flotantes.',
      bones: [
        bone(
          1,
          'Hueso plano e impar en el centro del pecho, formado por manubrio, cuerpo y apófisis xifoides.',
          'Esternón (impar, 1)',
          'El manubrio se articula con las clavículas y la 1.ª costilla. Su unión con el cuerpo, el ángulo esternal, marca la 2.ª costilla: el punto de partida para contarlas.',
        ),
        bone(
          14,
          '¿Cómo se llaman las costillas 1.ª a 7.ª, que llegan al esternón cada una con su propio cartílago costal?',
          'Costillas verdaderas o esternales (7 pares, 14)',
          'La 1.ª es la más corta y curva; por su cara superior pasan la arteria y la vena subclavias.',
        ),
        bone(
          6,
          '¿Cómo se llaman las costillas 8.ª a 10.ª, que llegan al esternón a través del cartílago de la costilla de arriba?',
          'Costillas falsas o vertebrocondrales (3 pares, 6)',
          'Sus cartílagos se unen al de la 7.ª y forman el reborde costal.',
        ),
        bone(
          4,
          '¿Cómo se llaman las costillas 11.ª y 12.ª, que no llegan al esternón?',
          'Costillas flotantes o vertebrales (2 pares, 4)',
          'Terminan libres entre los músculos de la pared del abdomen; solo se articulan con T11 y T12.',
        ),
      ],
      counts: [
        cloze(
          'El tórax tiene {{c1::25}} huesos: el esternón y {{c2::12}} pares de costillas.',
          '7 pares verdaderas, 3 falsas y 2 flotantes.',
        ),
      ],
    },
    {
      name: 'Cintura escapular, brazo y antebrazo',
      skeleton: 'appendicular',
      explanation:
        'Cada miembro superior tiene 32 huesos: 2 en la cintura escapular (clavícula y escápula), 1 en el brazo (húmero), 2 en el antebrazo (radio y ulna) y 27 en la mano.\n\nLa cintura escapular une el brazo al tronco, y solo se articula con el esqueleto axial por la clavícula, en la articulación esternoclavicular. En el antebrazo, en posición anatómica (palmas hacia adelante), el radio queda del lado del pulgar y la ulna del lado del meñique.',
      bones: [
        bone(
          2,
          'Hueso largo con forma de S que une el esternón con la escápula.',
          'Clavícula (par, 2)',
          'Es el único hueso que une el miembro superior al tronco, y uno de los que más se fracturan, casi siempre en su tercio medio.',
        ),
        bone(
          2,
          'Hueso plano y triangular en la parte posterior del tórax, con la cavidad glenoidea donde encaja el húmero.',
          'Escápula u omóplato (par, 2)',
          'Su espina termina en el acromion, que se articula con la clavícula. La apófisis coracoides es anclaje de músculos y ligamentos.',
        ),
        bone(
          2,
          'Hueso del brazo, entre el hombro y el codo.',
          'Húmero (par, 2)',
          'Su cabeza se articula con la cavidad glenoidea. El nervio radial corre por un surco en su diáfisis y el nervio ulnar pasa detrás del epicóndilo medial.',
        ),
        bone(
          2,
          'Hueso del antebrazo del lado del pulgar, que gira alrededor del otro al voltear la mano.',
          'Radio (par, 2)',
          'Su extremo distal se articula con el escafoides y el semilunar. Su fractura distal al caer con la mano extendida es de las más frecuentes (fractura de Colles).',
        ),
        bone(
          2,
          'Hueso del antebrazo del lado del meñique, cuyo olécranon forma la punta del codo.',
          'Ulna o cúbito (par, 2)',
          'Su escotadura troclear abraza la tróclea del húmero. Es más largo que el radio y no se articula directamente con el carpo.',
        ),
      ],
      counts: [
        cloze(
          'Cada miembro superior tiene {{c1::32}} huesos, contando la cintura escapular.',
          'Clavícula, escápula, húmero, radio, ulna y los 27 de la mano.',
        ),
      ],
    },
    {
      name: 'Mano',
      skeleton: 'appendicular',
      explanation:
        'Cada mano tiene 27 huesos: 8 del carpo (muñeca), 5 metacarpianos (palma) y 14 falanges (dedos).\n\nLos del carpo forman dos filas de 4. En la proximal, de lateral (pulgar) a medial: escafoides, semilunar, piramidal y pisiforme. En la distal, en el mismo orden: trapecio, trapezoide, grande y ganchoso. Los metacarpianos y los dedos se numeran del I (pulgar) al V (meñique).',
      bones: [
        bone(
          2,
          'Hueso del carpo en la fila proximal, el más lateral (lado del pulgar), con forma de barca.',
          'Escafoides (par, 2)',
          'Es el hueso del carpo que más se fractura; duele en la tabaquera anatómica. Por cómo le llega la sangre, el fragmento proximal puede necrosarse.',
        ),
        bone(
          2,
          'Hueso del carpo en la fila proximal, entre el escafoides y el piramidal, con forma de media luna.',
          'Semilunar (par, 2)',
          'Es el hueso del carpo que más se luxa; si se desplaza hacia la palma puede comprimir el nervio mediano en el túnel carpiano.',
        ),
        bone(
          2,
          'Hueso del carpo en la fila proximal, medial al semilunar, sobre el que se apoya el pisiforme.',
          'Piramidal (par, 2)',
          'Se articula con el pisiforme por delante y con el ganchoso en la fila distal.',
        ),
        bone(
          2,
          'El hueso más pequeño del carpo, con forma de guisante, en la fila proximal del lado del meñique.',
          'Pisiforme (par, 2)',
          'Es un sesamoideo dentro del tendón del músculo flexor ulnar del carpo; se palpa en la base de la palma, del lado del meñique.',
        ),
        bone(
          2,
          'Hueso del carpo en la fila distal, el más lateral, que se articula con el metacarpiano del pulgar.',
          'Trapecio (par, 2)',
          'Su articulación en silla de montar con el I metacarpiano permite la oposición del pulgar.',
        ),
        bone(
          2,
          'Hueso del carpo en la fila distal, entre el trapecio y el grande; el más pequeño de esa fila.',
          'Trapezoide (par, 2)',
          'Se articula con el II metacarpiano.',
        ),
        bone(
          2,
          'El hueso más grande del carpo, en el centro de la fila distal.',
          'Grande o capitado (par, 2)',
          'Se articula sobre todo con el III metacarpiano y es el primer hueso del carpo en osificarse.',
        ),
        bone(
          2,
          'Hueso del carpo en la fila distal del lado del meñique, con una apófisis en forma de gancho.',
          'Ganchoso o hamato (par, 2)',
          'Su gancho limita el canal de Guyon, por donde pasa el nervio ulnar. Se articula con los metacarpianos IV y V.',
        ),
        bone(
          10,
          'Huesos largos de la palma, numerados del I (pulgar) al V (meñique).',
          'Metacarpianos (5 por mano, 10)',
          'Sus cabezas son los nudillos. El I es el más corto y el más móvil; la fractura del cuello del V se conoce como fractura del boxeador.',
        ),
        bone(
          28,
          '¿Cuántas falanges tiene cada mano y por qué no son 15?',
          '14 por mano (28 en total): el pulgar tiene 2 (proximal y distal) y los otros dedos, 3 (proximal, media y distal).',
          'Se nombran por dedo y posición, por ejemplo «falange distal del II dedo». Las articulaciones entre ellas son las interfalángicas.',
        ),
      ],
      counts: [
        cloze(
          'Cada mano tiene {{c1::27}} huesos: {{c2::8}} del carpo, 5 metacarpianos y 14 falanges.',
          'Dos filas de 4 en el carpo; 2 falanges en el pulgar y 3 en cada otro dedo.',
        ),
      ],
    },
    {
      name: 'Cintura pélvica, muslo y pierna',
      skeleton: 'appendicular',
      explanation:
        'Cada miembro inferior tiene 31 huesos: el coxal (cintura pélvica), el fémur (muslo), la patela (rodilla), la tibia y la fíbula (pierna) y 26 en el pie.\n\nLos dos coxales se unen adelante en la sínfisis del pubis y atrás con el sacro: juntos forman la pelvis, que pasa el peso del tronco a las piernas. En la pierna, la tibia es medial y carga el peso; la fíbula es lateral y delgada.',
      bones: [
        bone(
          2,
          'Hueso plano formado por la fusión de ilion, isquion y pubis, con el acetábulo donde encaja el fémur.',
          'Coxal o hueso de la cadera (par, 2)',
          'Los tres huesos se fusionan en el acetábulo durante la adolescencia. Al sentarte te apoyas en las tuberosidades isquiáticas.',
        ),
        bone(
          2,
          'Hueso del muslo, el más largo y fuerte del cuerpo.',
          'Fémur (par, 2)',
          'Su cabeza encaja en el acetábulo del coxal. La fractura de su cuello es frecuente en personas mayores con osteoporosis.',
        ),
        bone(
          2,
          'Hueso sesamoideo frente a la rodilla, dentro del tendón del cuádriceps.',
          'Patela o rótula (par, 2)',
          'Es el sesamoideo más grande del cuerpo. Mejora la palanca del cuádriceps al extender la rodilla.',
        ),
        bone(
          2,
          'Hueso medial y grueso de la pierna que carga el peso; su borde anterior se palpa en la espinilla.',
          'Tibia (par, 2)',
          'Su maléolo medial forma la parte interna del tobillo y se articula con el talus.',
        ),
        bone(
          2,
          'Hueso lateral y delgado de la pierna, que casi no carga peso.',
          'Fíbula o peroné (par, 2)',
          'Su maléolo lateral forma la parte externa del tobillo. No participa en la articulación de la rodilla.',
        ),
      ],
      counts: [
        cloze(
          'Cada miembro inferior tiene {{c1::31}} huesos, contando el coxal.',
          'Coxal, fémur, patela, tibia, fíbula y los 26 del pie.',
        ),
      ],
    },
    {
      name: 'Pie',
      skeleton: 'appendicular',
      explanation:
        'Cada pie tiene 26 huesos: 7 del tarso, 5 metatarsianos y 14 falanges.\n\nEn el tarso, atrás están el talus (astrágalo), que se articula con la pierna, y el calcáneo (talón) debajo de él. En medio, del lado medial, el navicular. Adelante, los 3 cuneiformes (medial, intermedio y lateral) y, del lado lateral, el cuboides. Los metatarsianos y los dedos se numeran del I (dedo gordo) al V.',
      bones: [
        bone(
          2,
          'Hueso del tarso que se articula con la tibia y la fíbula y pasa el peso de la pierna al pie.',
          'Talus o astrágalo (par, 2)',
          'No tiene inserciones musculares. Forma la articulación del tobillo (talocrural) y abajo se articula con el calcáneo.',
        ),
        bone(
          2,
          'El hueso más grande del tarso, que forma el talón.',
          'Calcáneo (par, 2)',
          'En su cara posterior se inserta el tendón calcáneo (de Aquiles). Es el primero que toca el suelo al caminar.',
        ),
        bone(
          2,
          'Hueso del tarso con forma de barca, entre el talus y los cuneiformes, del lado medial del pie.',
          'Navicular o escafoides del pie (par, 2)',
          'Su tuberosidad se palpa en el borde medial del pie; en ella se inserta el músculo tibial posterior.',
        ),
        bone(
          2,
          'Hueso del tarso en el borde lateral del pie, entre el calcáneo y los metatarsianos IV y V.',
          'Cuboides (par, 2)',
          'Tiene un surco por donde pasa el tendón del músculo fibular (peroneo) largo.',
        ),
        bone(
          2,
          'El más grande de los tres cuneiformes, que se articula con el I metatarsiano.',
          'Cuneiforme medial (par, 2)',
          'Los tres cuneiformes están entre el navicular y los metatarsianos I a III, y ayudan a formar el arco transverso del pie.',
        ),
        bone(
          2,
          'El más pequeño de los tres cuneiformes, que se articula con el II metatarsiano.',
          'Cuneiforme intermedio (par, 2)',
          'Al ser más corto, deja la base del II metatarsiano encajada entre el cuneiforme medial y el lateral, lo que estabiliza el mediopié.',
        ),
        bone(
          2,
          'Cuneiforme que se articula con el III metatarsiano y, por fuera, con el cuboides.',
          'Cuneiforme lateral (par, 2)',
          'Se articula con el navicular por detrás y con los metatarsianos II a IV por delante.',
        ),
        bone(
          10,
          'Huesos largos entre el tarso y los dedos del pie, numerados del I (dedo gordo) al V.',
          'Metatarsianos (5 por pie, 10)',
          'El I es el más corto y grueso. La base del V tiene una tuberosidad, palpable en el borde lateral del pie, donde se inserta el músculo fibular (peroneo) corto.',
        ),
        bone(
          28,
          '¿Cuántas falanges tiene cada pie y qué dedo tiene solo 2?',
          '14 por pie (28 en total): el dedo gordo (hallux) tiene 2 y los otros dedos, 3.',
          'Se nombran igual que en la mano: proximal, media y distal. En el V dedo, la media y la distal a veces están fusionadas.',
        ),
      ],
      counts: [
        cloze(
          'Cada pie tiene {{c1::26}} huesos: {{c2::7}} del tarso, 5 metatarsianos y 14 falanges.',
          '2 falanges en el dedo gordo y 3 en cada otro dedo, como en la mano.',
        ),
      ],
    },
  ],
};

export interface BonesDeckRows {
  readonly deck: Deck;
  readonly topics: readonly Topic[];
  readonly notes: readonly Note[];
  readonly cards: readonly Card[];
}

/**
 * Las filas del mazo tal como viajan por sync, validadas con sus esquemas (AG2). IDs UUIDv7
 * (AG7) y un HLC del servidor (nodo nil, SYNC §2), como las escrituras propias del servidor.
 */
export function buildBonesDeck(now: number): BonesDeckRows {
  const meta = {
    hlc: encodeHlc({ wall: now, counter: 0, node: SERVER_NODE }),
    updatedAt: now,
    deletedAt: null,
  };
  const deck = DeckSchema.parse({
    id: newId(),
    name: BONES_DECK.name,
    description: BONES_DECK.description,
    ...meta,
  });
  const topics: Topic[] = [];
  const notes: Note[] = [];
  for (const entry of BONES_DECK.topics) {
    const topic = TopicSchema.parse({
      id: newId(),
      deckId: deck.id,
      name: entry.name,
      explanation: entry.explanation,
      ...meta,
    });
    topics.push(topic);
    for (const content of [...entry.bones.map((b) => b.content), ...entry.counts]) {
      notes.push(
        NoteSchema.parse({
          id: newId(),
          deckId: deck.id,
          topicId: topic.id,
          content,
          origin: 'manual',
          ...meta,
        }),
      );
    }
  }
  const sides = notes.flatMap((note) => cardOrdinals(note.content).map((ordinal) => ({ note, ordinal })));
  const cards = sides.map(({ note, ordinal }, i) =>
    CardSchema.parse({
      id: cardIdFor(note.id, ordinal),
      noteId: note.id,
      ordinal,
      // Las nuevas se ordenan por creación: así salen región por región, como el mazo.
      createdAt: now - (sides.length - i),
      lapseBaseline: 0,
      ...meta,
    }),
  );
  return { deck, topics, notes, cards };
}
