import {
  createClient, createAppointment,
  purgeClient, purgeAppointment,
  fetchDemoClients, fetchDemoAppointments,
  saveAppointment, saveClient, createReceipt,
  fetchDemoReceipts, purgeReceipt,
  createGiftCard, fetchDemoGiftCards, purgeGiftCard,
  fetchProducts, deleteProduct,
  createPromoCode, fetchPromoCodes,
  createMembership, createMembershipPlan, fetchMembershipPlans, fetchMemberships, purgeMembership, saveMembership,
  createTimeOff, fetchTimeOff, deleteTimeOff,
  createBonus, fetchBonuses, deleteBonus,
  saveWebfrontConfig, fetchWebfrontConfig,
  addToWaitlist,
  createCampaign,
  fetchEmployeesWithComp, saveEmployee, fetchEmployees, createEmployee,
} from '../lib/firestore';
import { db } from '../lib/firebase';
import { TENANT_ID } from '../lib/tenant';
import { collection, getDocs, query, where, deleteDoc, doc } from 'firebase/firestore';
import { seedProducts as seedProductCatalog } from './seedProducts';
import { SEED_EMPLOYEES } from './seedEmployees';

// ── Name pools ─────────────────────────────────────────
const FIRST_NAMES = [
  'Ashley','Brianna','Chloe','Danielle','Emily','Faith','Grace','Hannah','Isabella','Jessica',
  'Kayla','Lauren','Mia','Nicole','Olivia','Paige','Rachel','Sarah','Taylor','Victoria',
  'Amber','Brittany','Carmen','Diana','Elena','Fiona','Gina','Heather','Irene','Julia',
  'Kaitlyn','Lisa','Morgan','Natalie','Patricia','Quinn','Rebecca','Stephanie','Tiffany','Vanessa',
  'Wendy','Ximena','Yasmine','Zoe','Alexis','Beth','Crystal','Destiny','Eva','Frances',
  'Georgia','Holly','Iris','Jade','Karen','Leah','Melissa','Nina','Priya','Rosa',
  'Samantha','Tasha','Veronica','Whitney','Abby','Brooklyn','Donna','Elaine','Florence','Gloria',
  'Hazel','Ingrid','Joanna','Kelly','Lana','Monica','Nancy','Renee','Sandra','Tina',
  'Ariel','Cassandra','Dawn','Ebony','Felicia','Gwendolyn','Harper','Imani','Jada','Keisha',
  'Latoya','Monique','Nadia','Octavia','Portia','Regina','Shayla','Tamara','Unique','Valencia',
];

const LAST_NAMES = [
  'Carter','Williams','Martinez','Brooks','Johnson','Thompson','Lee','Davis','Wilson','Moore',
  'Anderson','Taylor','Jackson','Harris','Clark','Robinson','Lewis','Walker','Hall','Young',
  'Nguyen','King','Diaz','Patel','Kim','Walsh','Romano','Scott','Chen','Santos',
  'Rodriguez','Brown','Garcia','Miller','Jones','Smith','Thomas','White','Martin','Allen',
  'Wright','Hill','Mitchell','Turner','Phillips','Campbell','Parker','Evans','Collins','Stewart',
  'Sanchez','Morris','Rogers','Reed','Cook','Morgan','Bell','Murphy','Bailey','Rivera',
  'Cooper','Richardson','Cox','Howard','Ward','Torres','Peterson','Gray','Ramirez','James',
];

const COLUMBUS_STREETS = [
  '142 Polaris Pkwy','831 Bethel Rd','215 Graceland Blvd','5100 N High St','3300 Tremont Rd',
  '1490 Kenny Rd','755 Grandview Ave','4200 Reed Rd','2850 W Dublin Granville Rd','6700 Sawmill Rd',
  '500 W Broad St','1200 Chambers Rd','350 Ackerman Rd','4850 Olentangy River Rd','2200 Henderson Rd',
  '900 Goodale Blvd','3100 Tremont Rd','1750 Fishinger Rd','625 High St','2900 Riverside Dr',
  '4400 N High St','7500 Sawmill Rd','1100 Neil Ave','5200 Brand Rd','340 W Norwich Ave',
  '1650 Old Henderson Rd','3800 Riverside Dr','2100 Fishinger Rd','900 Ackerman Rd','4700 Olentangy River Rd',
];

const COLUMBUS_CITIES = ['Columbus, OH 43214','Columbus, OH 43220','Columbus, OH 43221','Dublin, OH 43017','Columbus, OH 43202','Columbus, OH 43212'];

const CLIENT_NOTES = [
  'Prefers coffin shape, loves bold colors','Gel-X regular, short almond','Sensitive cuticles, be gentle',
  'Monthly regular','Bi-weekly regular','Loves nail art, posts on IG','Gel manicure + paraffin wax always',
  'Structured gel, medium length','Removal + new set monthly','Allergic to certain acrylics — gel only',
  'Corporate client, neutral colors only','Brings tips in cash','Deluxe mani + pedi every month',
  'Nail art enthusiast','Student, loves dip','Lunchtime appointments preferred','French tip, very particular about shape',
  'Sensitive to strong smells','Prefers square shape','Always gets seasonal designs',
  '','','','','', // blanks so ~1/3 have no notes
];

// ── Celebrity data ──────────────────────────────────────
const CELEBRITIES = [
  { name: 'Beyoncé Knowles-Carter',  instagram: '@beyonce',          birthday: '1981-09-04', picture: 'https://randomuser.me/api/portraits/women/0.jpg',  notes: 'VIP — gel-x coffin, always brings glam inspo' },
  { name: 'Rihanna Fenty',           instagram: '@badgalriri',        birthday: '1988-02-20', picture: 'https://randomuser.me/api/portraits/women/1.jpg',  notes: 'Loves bold nail art and jewel tones, tips 40%' },
  { name: 'Kim Kardashian',          instagram: '@kimkardashian',     birthday: '1980-10-21', picture: 'https://randomuser.me/api/portraits/women/2.jpg',  notes: 'VIP — neutral tones, square shape, very punctual' },
  { name: 'Kylie Jenner',            instagram: '@kyliejenner',       tiktok: '@kyliejenner', birthday: '1997-08-10', picture: 'https://randomuser.me/api/portraits/women/3.jpg',  notes: 'Always photographs nails — loves extra-long coffin' },
  { name: 'Taylor Swift',            instagram: '@taylorswift',       birthday: '1989-12-13', picture: 'https://randomuser.me/api/portraits/women/4.jpg',  notes: 'Red nails always — short square, very sweet' },
  { name: 'Ariana Grande',           instagram: '@arianagrande',      birthday: '1993-06-26', picture: 'https://randomuser.me/api/portraits/women/5.jpg',  notes: 'Short almond, nude tones, gel manicure regular' },
  { name: 'Cardi B',                 instagram: '@iamcardib',         tiktok: '@iamcardib', birthday: '1992-10-11', picture: 'https://randomuser.me/api/portraits/women/6.jpg',  notes: 'Extra long, wild designs — always hypes up the salon' },
  { name: 'Nicki Minaj',             instagram: '@nickiminaj',        birthday: '1982-12-08', picture: 'https://randomuser.me/api/portraits/women/7.jpg',  notes: 'Loves 3D nail art and crystals, long stiletto' },
  { name: 'Selena Gomez',            instagram: '@selenagomez',       birthday: '1992-07-22', picture: 'https://randomuser.me/api/portraits/women/8.jpg',  notes: 'Short oval, soft pinks and nudes, gel polish change' },
  { name: 'Lady Gaga',               instagram: '@ladygaga',          birthday: '1986-03-28', picture: 'https://randomuser.me/api/portraits/women/9.jpg',  notes: 'Always wants something avant-garde and unique' },
  { name: 'Jennifer Lopez',          instagram: '@jlo',               birthday: '1969-07-24', picture: 'https://randomuser.me/api/portraits/women/10.jpg', notes: 'Glam mani + pedi combo, loves gold accents' },
  { name: 'Doja Cat',                instagram: '@dojacat',           tiktok: '@dojacat', birthday: '1995-10-21', picture: 'https://randomuser.me/api/portraits/women/11.jpg', notes: 'Creative nail art enthusiast, loves unexpected designs' },
  { name: 'Lizzo',                   instagram: '@lizzo',             tiktok: '@lizzo', birthday: '1988-04-27', picture: 'https://randomuser.me/api/portraits/women/12.jpg', notes: 'Fun and colorful, loves rhinestones, great energy' },
  { name: 'Megan Thee Stallion',     instagram: '@theestallion',      birthday: '1995-02-15', picture: 'https://randomuser.me/api/portraits/women/13.jpg', notes: 'Extra long coffin, bold patterns — posts everything' },
  { name: 'Zendaya Coleman',         instagram: '@zendaya',           birthday: '1996-09-01', picture: 'https://randomuser.me/api/portraits/women/14.jpg', notes: 'Minimalist and elegant, short almond neutral tones' },
  { name: 'Billie Eilish',           instagram: '@billieeilish',      birthday: '2001-12-18', picture: 'https://randomuser.me/api/portraits/women/15.jpg', notes: 'Dark moody tones, loves black and dark green' },
  { name: 'SZA',                     instagram: '@sza',               birthday: '1989-11-08', picture: 'https://randomuser.me/api/portraits/women/16.jpg', notes: 'Earthy tones, medium coffin, very chill client' },
  { name: 'Halle Bailey',            instagram: '@hallebailey',       birthday: '2000-03-27', picture: 'https://randomuser.me/api/portraits/women/17.jpg', notes: 'Romantic and feminine, loves pastels and pearls' },
  { name: 'Normani',                 instagram: '@normani',           birthday: '1996-05-31', picture: 'https://randomuser.me/api/portraits/women/18.jpg', notes: 'Extra long stiletto, loves metallic and chrome' },
  { name: 'Victoria Beckham',        instagram: '@victoriabeckham',   birthday: '1974-04-17', picture: 'https://randomuser.me/api/portraits/women/19.jpg', notes: 'Nude square, very polished and precise' },
  { name: 'Keke Palmer',             instagram: '@keke',              birthday: '1993-08-26', picture: 'https://randomuser.me/api/portraits/women/20.jpg', notes: 'Fun and playful, loves nail art and bright colors' },
  { name: 'Taraji P. Henson',        instagram: '@tarajiphenson',     birthday: '1970-09-11', picture: 'https://randomuser.me/api/portraits/women/21.jpg', notes: 'Elegant coffin shape, loves burgundy and deep reds' },
  { name: 'Kerry Washington',        instagram: '@kerrywashington',   birthday: '1977-01-31', picture: 'https://randomuser.me/api/portraits/women/22.jpg', notes: 'Classic French tip, very professional' },
  { name: 'Viola Davis',             instagram: '@violadavis',        birthday: '1965-08-11', picture: 'https://randomuser.me/api/portraits/women/23.jpg', notes: 'Short square, classic red or nude — very regal' },
  { name: "Lupita Nyong'o",          instagram: '@lupitanyongo',      birthday: '1983-03-01', picture: 'https://randomuser.me/api/portraits/women/24.jpg', notes: 'Bold colors, loves designs that complement her skin tone' },
  { name: 'Issa Rae',                instagram: '@issarae',           birthday: '1985-01-12', picture: 'https://randomuser.me/api/portraits/women/25.jpg', notes: 'Gel manicure, loves trying new colors each visit' },
  { name: 'Priyanka Chopra',         instagram: '@priyankachopra',    birthday: '1982-07-18', picture: 'https://randomuser.me/api/portraits/women/26.jpg', notes: 'Glamorous, often gets nail art for events' },
  { name: 'Mindy Kaling',            instagram: '@mindykaling',       birthday: '1979-06-24', picture: 'https://randomuser.me/api/portraits/women/27.jpg', notes: 'Fun bright colors, short almond, very chatty and sweet' },
  { name: 'Halle Berry',             instagram: '@halleberry',        birthday: '1966-08-14', picture: 'https://randomuser.me/api/portraits/women/28.jpg', notes: 'Natural and elegant, short square or oval' },
  { name: 'Mary J. Blige',           instagram: '@maryjblige',        birthday: '1971-01-11', picture: 'https://randomuser.me/api/portraits/women/29.jpg', notes: 'Long coffin, loves bronzey golds and warm tones' },
  { name: 'Alicia Keys',             instagram: '@aliciakeys',        birthday: '1981-01-25', picture: 'https://randomuser.me/api/portraits/women/30.jpg', notes: 'Natural and clean, often comes in for spa pedicure' },
  { name: 'Mariah Carey',            instagram: '@mariahcarey',       birthday: '1969-03-27', picture: 'https://randomuser.me/api/portraits/women/31.jpg', notes: 'Long pink coffin, very glamorous, always VIP treatment' },
  { name: 'Britney Spears',          instagram: '@britneyspears',     birthday: '1981-12-02', picture: 'https://randomuser.me/api/portraits/women/32.jpg', notes: 'Pink and playful, loves glitter' },
  { name: 'Paris Hilton',            instagram: '@parishilton',       birthday: '1981-02-17', picture: 'https://randomuser.me/api/portraits/women/33.jpg', notes: 'Long French tip or pale pink, very glam' },
  { name: 'Shakira',                 instagram: '@shakira',           birthday: '1977-02-02', picture: 'https://randomuser.me/api/portraits/women/34.jpg', notes: 'Natural and fun, loves warm earth tones' },
  { name: 'Jennifer Aniston',        instagram: '@jenniferaniston',   birthday: '1969-02-11', picture: 'https://randomuser.me/api/portraits/women/35.jpg', notes: 'Short square, classic nudes — very low maintenance' },
  { name: 'Reese Witherspoon',       instagram: '@reesewitherspoon',  birthday: '1976-03-22', picture: 'https://randomuser.me/api/portraits/women/36.jpg', notes: 'Southern charm, loves pastels and French tips' },
  { name: 'Sofia Vergara',           instagram: '@sofiavergara',      birthday: '1972-07-10', picture: 'https://randomuser.me/api/portraits/women/37.jpg', notes: 'Bold and glamorous, coffin shape, loves deep reds' },
  { name: 'Eva Longoria',            instagram: '@evalongoria',       birthday: '1975-03-15', picture: 'https://randomuser.me/api/portraits/women/38.jpg', notes: 'Classic and elegant, always gets a gel manicure' },
  { name: 'Jessica Alba',            instagram: '@jessicaalba',       birthday: '1981-04-28', picture: 'https://randomuser.me/api/portraits/women/39.jpg', notes: 'Natural and clean beauty, short oval, nudes' },
  { name: 'Hailey Bieber',           instagram: '@haileybieber',      birthday: '1996-11-22', picture: 'https://randomuser.me/api/portraits/women/40.jpg', notes: 'Glazed donut nails! Short square, chrome and shimmer' },
  { name: 'Gigi Hadid',              instagram: '@gigihadid',         birthday: '1995-04-23', picture: 'https://randomuser.me/api/portraits/women/41.jpg', notes: 'Trendy and chic, short almond, always on-trend' },
  { name: 'Bella Hadid',             instagram: '@bellahadid',        tiktok: '@bellahadid', birthday: '1996-10-09', picture: 'https://randomuser.me/api/portraits/women/42.jpg', notes: 'Edgy and fashion-forward, loves dark tones and graphic art' },
  { name: 'Kendall Jenner',          instagram: '@kendalljenner',     birthday: '1995-11-03', picture: 'https://randomuser.me/api/portraits/women/43.jpg', notes: 'Minimal and clean, very short nails, nudes only' },
  { name: 'Emily Ratajkowski',       instagram: '@emrata',            birthday: '1991-06-07', picture: 'https://randomuser.me/api/portraits/women/44.jpg', notes: 'Effortlessly cool, medium length, nudes and terracottas' },
  { name: 'Ashley Graham',           instagram: '@ashleygraham',      birthday: '1987-10-30', picture: 'https://randomuser.me/api/portraits/women/45.jpg', notes: 'Confident and bold, loves color-blocked nails' },
  { name: 'Chrissy Teigen',          instagram: '@chrissyteigen',     birthday: '1985-11-30', picture: 'https://randomuser.me/api/portraits/women/46.jpg', notes: 'Fun and sassy, loves themed nail art for events' },
  { name: 'Gabrielle Union',         instagram: '@gabunion',          birthday: '1972-10-29', picture: 'https://randomuser.me/api/portraits/women/47.jpg', notes: 'Timeless elegance, short coffin or square, reds and nudes' },
  { name: 'Laverne Cox',             instagram: '@lavernecox',        birthday: '1972-05-29', picture: 'https://randomuser.me/api/portraits/women/48.jpg', notes: 'Long and glamorous, loves bold ombre and gradient' },
  { name: 'Kelly Rowland',           instagram: '@kellyrowland',      birthday: '1981-02-11', picture: 'https://randomuser.me/api/portraits/women/49.jpg', notes: 'Classic and chic, medium coffin, rich jewel tones' },
  { name: 'Ciara Harris',            instagram: '@ciara',             birthday: '1985-10-25', picture: 'https://randomuser.me/api/portraits/women/50.jpg', notes: 'Athletic and elegant, loves sculpted medium-length nails' },
  { name: 'Jhené Aiko',              instagram: '@jheneaiko',         birthday: '1988-03-16', picture: 'https://randomuser.me/api/portraits/women/51.jpg', notes: 'Dreamy and ethereal, loves pastel swirls and crystals' },
  { name: 'Summer Walker',           instagram: '@summerwalker',      birthday: '1996-04-11', picture: 'https://randomuser.me/api/portraits/women/52.jpg', notes: 'Long claws always, loves patterns and textures' },
  { name: 'Kehlani',                 instagram: '@kehlani',           birthday: '1995-04-24', picture: 'https://randomuser.me/api/portraits/women/53.jpg', notes: 'Artsy and free-spirited, mismatched nail art lover' },
  { name: 'Teyana Taylor',           instagram: '@teyanataylor',      birthday: '1990-12-10', picture: 'https://randomuser.me/api/portraits/women/54.jpg', notes: 'Fierce and fashion-forward, long stilettos with graphics' },
  { name: 'Tiffany Haddish',         instagram: '@tiffanyhaddish',    birthday: '1979-12-03', picture: 'https://randomuser.me/api/portraits/women/55.jpg', notes: 'Bubbly and fun, loves themed nail art — great tipper' },
  { name: 'Niecy Nash',              instagram: '@niecynash',         birthday: '1970-02-23', picture: 'https://randomuser.me/api/portraits/women/56.jpg', notes: 'Glamorous and bold, loves deep pinks and purples' },
  { name: 'Drew Barrymore',          instagram: '@drewbarrymore',     birthday: '1975-02-22', picture: 'https://randomuser.me/api/portraits/women/57.jpg', notes: 'Bohemian and colorful, loves eclectic nail designs' },
  { name: 'Nicole Kidman',           instagram: '@nicolekidman',      birthday: '1967-06-20', picture: 'https://randomuser.me/api/portraits/women/58.jpg', notes: 'Sophisticated and classic, pale pink oval nails' },
  { name: 'Anne Hathaway',           instagram: '@annehathaway',      birthday: '1982-11-12', picture: 'https://randomuser.me/api/portraits/women/59.jpg', notes: 'Polished and chic, classic colors, medium square' },
  { name: 'Blake Lively',            instagram: '@blakelively',       birthday: '1987-08-25', picture: 'https://randomuser.me/api/portraits/women/60.jpg', notes: 'Effortlessly stylish, loves seasonal nail themes' },
  { name: 'Emma Roberts',            instagram: '@emmaroberts',       birthday: '1991-02-10', picture: 'https://randomuser.me/api/portraits/women/61.jpg', notes: 'Chic and fashion-forward, loves subtle nail art' },
  { name: 'Olivia Wilde',            instagram: '@oliviawilde',       birthday: '1984-03-10', picture: 'https://randomuser.me/api/portraits/women/62.jpg', notes: 'Artsy and expressive, shorter length for film sets' },
  { name: 'Regina Hall',             instagram: '@reginahall',        birthday: '1970-12-12', picture: 'https://randomuser.me/api/portraits/women/63.jpg', notes: 'Glam queen, loves bold reds and long coffin' },
  { name: 'Ari Lennox',              instagram: '@arilennox',         birthday: '1991-03-26', picture: 'https://randomuser.me/api/portraits/women/64.jpg', notes: 'Neo-soul vibes, loves earth tones and natural shapes' },
  { name: 'Tinashe',                 instagram: '@tinashe',           birthday: '1993-02-06', picture: 'https://randomuser.me/api/portraits/women/65.jpg', notes: 'Cool girl, loves minimalist nail art with a twist' },
  { name: 'Ice Spice',               instagram: '@icespice',          tiktok: '@icespicee', birthday: '2000-01-01', picture: 'https://randomuser.me/api/portraits/women/66.jpg', notes: 'Always gets bright orange or hot pink, extra long coffin' },
  { name: 'Tyla',                    instagram: '@tyla',              tiktok: '@tyla', birthday: '2002-01-30', picture: 'https://randomuser.me/api/portraits/women/67.jpg', notes: 'Rising star, loves trendy nail shapes and designs' },
  { name: 'Latto',                   instagram: '@latto777',          birthday: '1998-12-22', picture: 'https://randomuser.me/api/portraits/women/68.jpg', notes: 'Boss vibes, long coffin with custom art' },
  { name: 'Chloe Bailey',            instagram: '@chloebailey',       birthday: '2001-07-01', picture: 'https://randomuser.me/api/portraits/women/69.jpg', notes: 'Always stunning, loves chrome and metallic finishes' },
  { name: 'Halsey',                  instagram: '@halsey',            birthday: '1994-09-29', picture: 'https://randomuser.me/api/portraits/women/70.jpg', notes: 'Alternative and expressive, loves dark colors and art' },
  { name: 'Serena Williams',         instagram: '@serenawilliams',    birthday: '1981-09-26', picture: 'https://randomuser.me/api/portraits/women/71.jpg', notes: 'Champion energy — strong coffin, bold colors' },
  { name: 'Simone Biles',            instagram: '@simonebiles',       birthday: '1997-03-14', picture: 'https://randomuser.me/api/portraits/women/72.jpg', notes: 'Fun and sporty, prefers shorter length for gymnastics' },
  { name: 'Naomi Osaka',             instagram: '@naomiosaka',        birthday: '1997-10-16', picture: 'https://randomuser.me/api/portraits/women/73.jpg', notes: 'Tennis-safe shorter length, loves pastel designs' },
  { name: 'Michelle Obama',          instagram: '@michelleobama',     birthday: '1964-01-17', picture: 'https://randomuser.me/api/portraits/women/74.jpg', notes: 'Former First Lady — classic, dignified, always neutral tones' },
  { name: 'Oprah Winfrey',           instagram: '@oprah',             birthday: '1954-01-29', picture: 'https://randomuser.me/api/portraits/women/75.jpg', notes: 'Power client, monthly standing appt, French tip classic' },
  { name: 'Dolly Parton',            instagram: '@dollyparton',       birthday: '1946-01-19', picture: 'https://randomuser.me/api/portraits/women/76.jpg', notes: 'Famous for her long nails — bright and bedazzled always' },
  { name: 'Katy Perry',              instagram: '@katyperry',         birthday: '1984-10-25', picture: 'https://randomuser.me/api/portraits/women/77.jpg', notes: 'Loves themed nail art, always fun and colorful' },
  { name: 'Demi Lovato',             instagram: '@ddlovato',          birthday: '1992-08-20', picture: 'https://randomuser.me/api/portraits/women/78.jpg', notes: 'Rock-and-roll vibes, loves edgy dark nail art' },
  { name: 'Miley Cyrus',             instagram: '@mileycyrus',        birthday: '1992-11-23', picture: 'https://randomuser.me/api/portraits/women/79.jpg', notes: 'Wild and expressive, ever-changing styles' },
  { name: 'Adele',                   instagram: '@adele',             birthday: '1988-05-05', picture: 'https://randomuser.me/api/portraits/women/80.jpg', notes: 'Classic red or deep wine coffin, very elegant' },
  { name: 'Christina Aguilera',      instagram: '@xtina',             birthday: '1980-12-18', picture: 'https://randomuser.me/api/portraits/women/81.jpg', notes: 'Fierce diva energy, long nails with bold designs' },
  { name: 'Gwen Stefani',            instagram: '@gwenstefani',       birthday: '1969-10-03', picture: 'https://randomuser.me/api/portraits/women/82.jpg', notes: 'Punk-glam, loves graphic nail art, red to match lips' },
  { name: 'Janet Jackson',           instagram: '@janetjackson',      birthday: '1966-05-16', picture: 'https://randomuser.me/api/portraits/women/83.jpg', notes: 'Icon client, classic and classy, medium coffin' },
  { name: 'Amber Rose',              instagram: '@amberrose',         birthday: '1983-10-21', picture: 'https://randomuser.me/api/portraits/women/84.jpg', notes: 'Bold and unapologetic, loves striking statement nails' },
  { name: 'Saweetie',                instagram: '@saweetie',          birthday: '1993-07-02', picture: 'https://randomuser.me/api/portraits/women/85.jpg', notes: 'Icy girl vibes — loves chrome and holographic nails' },
  { name: 'GloRilla',                instagram: '@glorillapimp',      tiktok: '@glorillapimp', birthday: '1999-06-28', picture: 'https://randomuser.me/api/portraits/women/86.jpg', notes: 'Extra and unapologetic, loves wild designs + rhinestones' },
  { name: 'Tems',                    instagram: '@temsbaby',          birthday: '1995-06-11', picture: 'https://randomuser.me/api/portraits/women/87.jpg', notes: 'Afrobeats royalty, loves rich earth tones and warm neutrals' },
  { name: 'H.E.R.',                  instagram: '@hermusicofficial',  birthday: '1997-06-27', picture: 'https://randomuser.me/api/portraits/women/88.jpg', notes: 'Mysterious and cool, loves dark moody nail art' },
  { name: 'Jada Pinkett Smith',      instagram: '@jadapinkettsmith',  birthday: '1971-09-18', picture: 'https://randomuser.me/api/portraits/women/89.jpg', notes: 'Warrior vibes — bold, strong shapes, deep jewel tones' },
  { name: 'Cynthia Erivo',           instagram: '@cynthiaerivo',      birthday: '1987-01-08', picture: 'https://randomuser.me/api/portraits/women/90.jpg', notes: 'Award season regular — always comes in event-ready' },
  { name: 'Fantasia Barrino',        instagram: '@tasiasword',        birthday: '1984-06-30', picture: 'https://randomuser.me/api/portraits/women/91.jpg', notes: 'Idol to Hollywood glam — loves colorful creative designs' },
  { name: 'Jennifer Hudson',         instagram: '@iamjhud',           birthday: '1981-09-12', picture: 'https://randomuser.me/api/portraits/women/92.jpg', notes: 'EGOT winner — always comes in before shows and events' },
  { name: 'Brandy Norwood',          instagram: '@4everbrandy',       birthday: '1979-02-11', picture: 'https://randomuser.me/api/portraits/women/93.jpg', notes: 'R&B royalty, loves soft feminine shapes and pinks' },
  { name: 'Monica Arnold',           instagram: '@monicadenise',      birthday: '1980-10-24', picture: 'https://randomuser.me/api/portraits/women/94.jpg', notes: 'Classic R&B vibes, medium coffin, reds and nudes' },
  { name: 'Ashanti',                 instagram: '@ashanti',           birthday: '1980-10-13', picture: 'https://randomuser.me/api/portraits/women/95.jpg', notes: 'Y2K nostalgia with modern flair, loves metallic tones' },
  { name: 'Cassie Ventura',          instagram: '@cassie',            birthday: '1986-08-26', picture: 'https://randomuser.me/api/portraits/women/96.jpg', notes: 'Model precision, always arrives early, loves clean designs' },
  { name: 'Eva Mendes',              instagram: '@evamendes',         birthday: '1974-03-05', picture: 'https://randomuser.me/api/portraits/women/97.jpg', notes: 'Vintage Hollywood glam, classic red nails always' },
  { name: 'Sandra Oh',               instagram: '@iamsandraoh',       birthday: '1971-07-20', picture: 'https://randomuser.me/api/portraits/women/98.jpg', notes: 'Sophisticated and minimal, loves understated elegance' },
  { name: 'Nathalie Emmanuel',       instagram: '@nathalieemmanuel',  birthday: '1989-03-02', picture: 'https://randomuser.me/api/portraits/women/99.jpg', notes: 'Game of Thrones glam — loves rich jewel-tone designs' },
];

const CELEBRITIES_2 = [
  { name: 'Dua Lipa',               instagram: '@dualipa',           tiktok: '@dualipaofficial', birthday: '1995-08-22', picture: 'https://randomuser.me/api/portraits/women/0.jpg',  notes: 'Pop princess — loves chrome nails and futuristic designs' },
  { name: 'Olivia Rodrigo',         instagram: '@oliviarodrigo',     birthday: '2003-02-20', picture: 'https://randomuser.me/api/portraits/women/1.jpg',  notes: 'Dark romance aesthetic, loves black with red accents' },
  { name: 'Sabrina Carpenter',      instagram: '@sabrinacarpenter',  birthday: '1999-05-11', picture: 'https://randomuser.me/api/portraits/women/2.jpg',  notes: 'Retro pinup vibes, loves cherry red and classic French' },
  { name: 'Charli XCX',             instagram: '@charlixcx',         birthday: '1992-08-02', picture: 'https://randomuser.me/api/portraits/women/3.jpg',  notes: 'BRAT energy — lime green, chrome, very avant-garde' },
  { name: 'Camila Cabello',         instagram: '@camilacabello',     birthday: '1997-03-03', picture: 'https://randomuser.me/api/portraits/women/4.jpg',  notes: 'Romantic and playful, loves ombre and floral designs' },
  { name: 'Bebe Rexha',             instagram: '@beberexha',         birthday: '1989-08-30', picture: 'https://randomuser.me/api/portraits/women/5.jpg',  notes: 'Rock meets glam — bold colors, loves crystals and gems' },
  { name: 'Meghan Markle',          instagram: '@meghan',            birthday: '1981-08-04', picture: 'https://randomuser.me/api/portraits/women/6.jpg',  notes: 'Duchess vibes — very clean, short oval, sheer nude only' },
  { name: 'Naomi Campbell',         instagram: '@naomi',             birthday: '1970-05-22', picture: 'https://randomuser.me/api/portraits/women/7.jpg',  notes: 'Supermodel legend, long dramatic nails, editorial looks' },
  { name: 'Tyra Banks',             instagram: '@tyrabanks',         birthday: '1973-12-04', picture: 'https://randomuser.me/api/portraits/women/8.jpg',  notes: 'Smizes with her nails — always fierce coffin shapes' },
  { name: 'Missy Elliott',          instagram: '@missyelliott',      birthday: '1971-07-01', picture: 'https://randomuser.me/api/portraits/women/9.jpg',  notes: 'Iconic and bold, loves wild patterns and holographic' },
  { name: "Lil' Kim",               instagram: '@lilkim',            birthday: '1974-07-11', picture: 'https://randomuser.me/api/portraits/women/10.jpg', notes: 'Queen Bee of nail art — extra long, bedazzled, always VIP' },
  { name: 'Megan Fox',              instagram: '@meganfox',          birthday: '1986-05-16', picture: 'https://randomuser.me/api/portraits/women/11.jpg', notes: 'Dark sultry tones, long coffin, loves black and deep jewels' },
  { name: 'Scarlett Johansson',     instagram: '@scarletjohansson',  birthday: '1984-11-22', picture: 'https://randomuser.me/api/portraits/women/12.jpg', notes: 'Classic Hollywood glam, clean and polished always' },
  { name: 'Margot Robbie',          instagram: '@margotrobbie',      birthday: '1990-07-02', picture: 'https://randomuser.me/api/portraits/women/13.jpg', notes: 'Barbie pink era + classic Aussie chill — loves any pink' },
  { name: 'Florence Pugh',          instagram: '@florencepugh',      birthday: '1996-01-03', picture: 'https://randomuser.me/api/portraits/women/14.jpg', notes: 'Bold and unapologetic, loves unexpected color combos' },
  { name: 'Sydney Sweeney',         instagram: '@sydneysweeney',     birthday: '1997-09-12', picture: 'https://randomuser.me/api/portraits/women/15.jpg', notes: 'All-American glam, loves classic French tip and soft pinks' },
  { name: 'Jenna Ortega',           instagram: '@jennaortega',       birthday: '2002-09-27', picture: 'https://randomuser.me/api/portraits/women/16.jpg', notes: 'Wednesday aesthetic — black nails, dark and dramatic' },
  { name: 'Anya Taylor-Joy',        instagram: '@anyataylorjoy',     birthday: '1996-04-16', picture: 'https://randomuser.me/api/portraits/women/17.jpg', notes: 'Ethereal and otherworldly, loves pale lavender and pearl' },
  { name: 'Millie Bobby Brown',     instagram: '@milliebobbybrown',  birthday: '2004-02-19', picture: 'https://randomuser.me/api/portraits/women/18.jpg', notes: 'Gen Z icon, loves trendy Y2K designs and butterfly nails' },
  { name: 'Emma Watson',            instagram: '@emmawatson',        birthday: '1990-04-15', picture: 'https://randomuser.me/api/portraits/women/19.jpg', notes: 'Minimalist and eco-conscious, short oval, natural tones' },
  { name: 'Kourtney Kardashian',    instagram: '@kourtneykardash',   birthday: '1979-04-18', picture: 'https://randomuser.me/api/portraits/women/20.jpg', notes: 'Edgy and dark, loves black and gothic-inspired designs' },
  { name: 'Khloé Kardashian',       instagram: '@khloekardashian',   birthday: '1984-06-27', picture: 'https://randomuser.me/api/portraits/women/21.jpg', notes: 'Fitness glam — always polished, loves neutral almond shape' },
  { name: 'Kris Jenner',            instagram: '@krisjenner',        birthday: '1955-11-05', picture: 'https://randomuser.me/api/portraits/women/22.jpg', notes: 'The momager herself — classic, powerful, always on brand' },
  { name: 'Janelle Monáe',          instagram: '@janellemonae',      birthday: '1985-12-01', picture: 'https://randomuser.me/api/portraits/women/23.jpg', notes: 'Black and white aesthetic with bold pops of color' },
  { name: 'Kacey Musgraves',        instagram: '@spaceykacey',       birthday: '1988-08-21', picture: 'https://randomuser.me/api/portraits/women/24.jpg', notes: 'Cosmic cowgirl — loves rainbow, stars, and retro designs' },
  { name: 'Miranda Lambert',        instagram: '@mirandalambert',    birthday: '1983-11-10', picture: 'https://randomuser.me/api/portraits/women/25.jpg', notes: 'Country queen, loves classic reds and Western-inspired art' },
  { name: 'Carrie Underwood',       instagram: '@carrieunderwood',   birthday: '1983-03-10', picture: 'https://randomuser.me/api/portraits/women/26.jpg', notes: 'Country glam, always comes in before tour season' },
  { name: 'Shania Twain',           instagram: '@shania_twain',      birthday: '1964-08-28', picture: 'https://randomuser.me/api/portraits/women/27.jpg', notes: 'Feels like a woman with bold, dramatic nails to match' },
  { name: 'Celine Dion',            instagram: '@celinedion',        birthday: '1968-03-30', picture: 'https://randomuser.me/api/portraits/women/28.jpg', notes: 'Grand diva energy, loves classic white or pale pink' },
  { name: 'Quinta Brunson',         instagram: '@quintabrunson',     birthday: '1990-12-21', picture: 'https://randomuser.me/api/portraits/women/29.jpg', notes: 'Hilarious and warm, loves fun patterns and bright colors' },
  { name: 'Ayo Edebiri',            instagram: '@ayoedebiri',        birthday: '1995-07-23', picture: 'https://randomuser.me/api/portraits/women/30.jpg', notes: 'IT girl energy, loves understated cool-girl nails' },
  { name: 'Natasha Lyonne',         instagram: '@natashalyonne',     birthday: '1979-04-04', picture: 'https://randomuser.me/api/portraits/women/31.jpg', notes: 'Quirky and cool, loves retro designs and unexpected colors' },
  { name: 'Maya Rudolph',           instagram: '@mayarudolph',       birthday: '1972-07-27', picture: 'https://randomuser.me/api/portraits/women/32.jpg', notes: 'Playful and charismatic, loves fun seasonal nail themes' },
  { name: 'Amy Poehler',            instagram: '@amypoehler',        birthday: '1971-09-16', picture: 'https://randomuser.me/api/portraits/women/33.jpg', notes: 'Fun and approachable, loves colorful and whimsical nails' },
  { name: 'Tina Fey',               instagram: '@tinafey',           birthday: '1970-05-18', picture: 'https://randomuser.me/api/portraits/women/34.jpg', notes: 'Smart and classic, prefers short and neat with subtle polish' },
  { name: 'Rachel Zegler',          instagram: '@rachelzegler',      birthday: '2001-05-03', picture: 'https://randomuser.me/api/portraits/women/35.jpg', notes: 'Disney princess energy, loves soft pinks and florals' },
  { name: 'Coco Jones',             instagram: '@cocojones',         birthday: '1998-01-04', picture: 'https://randomuser.me/api/portraits/women/36.jpg', notes: 'R&B rising star, loves chic medium-length coffin' },
  { name: 'Victoria Monét',         instagram: '@victoriamone',      birthday: '1993-12-01', picture: 'https://randomuser.me/api/portraits/women/37.jpg', notes: 'Grammy-era glam — loves bold and sultry nail looks' },
  { name: 'Doechii',                instagram: '@doechii',           birthday: '2001-08-14', picture: 'https://randomuser.me/api/portraits/women/38.jpg', notes: 'Avant-garde and experimental, always wants something wild' },
  { name: 'Yung Miami',             instagram: '@yungmiami305',      birthday: '1994-02-11', picture: 'https://randomuser.me/api/portraits/women/39.jpg', notes: 'City Girl vibes — long, flashy, loves neon and chrome' },
  { name: 'JT (City Girls)',         instagram: '@thegirlljt',        birthday: '1992-12-06', picture: 'https://randomuser.me/api/portraits/women/40.jpg', notes: 'Extra long press-ons, loves bold and show-stopping designs' },
  { name: 'Flo Milli',              instagram: '@flomilliee',        birthday: '2000-01-09', picture: 'https://randomuser.me/api/portraits/women/41.jpg', notes: 'Spunky and fearless, loves hot pink and electric nails' },
  { name: 'FKA Twigs',              instagram: '@fkatwigs',          birthday: '1988-01-16', picture: 'https://randomuser.me/api/portraits/women/42.jpg', notes: 'Otherworldly and artistic, loves sculptural nail designs' },
  { name: 'Jorja Smith',            instagram: '@jorjasmith',        birthday: '1997-06-11', picture: 'https://randomuser.me/api/portraits/women/43.jpg', notes: 'British cool-girl, minimal and effortless' },
  { name: 'Rina Sawayama',          instagram: '@rinasawayama',      birthday: '1990-08-16', picture: 'https://randomuser.me/api/portraits/women/44.jpg', notes: 'Y2K meets pop art — loves bold graphic nail designs' },
  { name: 'Caroline Polachek',      instagram: '@carolinepolachek',  birthday: '1985-08-08', picture: 'https://randomuser.me/api/portraits/women/45.jpg', notes: 'Art-pop diva, loves surreal and dreamlike nail aesthetics' },
  { name: 'Phoebe Bridgers',        instagram: '@phoebebridgers',    birthday: '1994-08-17', picture: 'https://randomuser.me/api/portraits/women/46.jpg', notes: 'Sad girl but make it cute — loves skeleton and ghost designs' },
  { name: 'Maggie Rogers',          instagram: '@maggierogers',      birthday: '1994-04-25', picture: 'https://randomuser.me/api/portraits/women/47.jpg', notes: 'Nature-inspired, loves earthy tones and botanical designs' },
  { name: 'Gracie Abrams',          instagram: '@gracieabrams',      birthday: '1999-09-07', picture: 'https://randomuser.me/api/portraits/women/48.jpg', notes: 'Indie darling, loves soft and understated nail art' },
  { name: 'Muni Long',              instagram: '@munilong',          birthday: '1993-08-10', picture: 'https://randomuser.me/api/portraits/women/49.jpg', notes: 'Underrated queen, loves elegant long nails with gold accents' },
  { name: 'Addison Rae',            instagram: '@addisonraee',       birthday: '2000-10-06', picture: 'https://randomuser.me/api/portraits/women/50.jpg', notes: 'TikTok queen turned pop star, loves trendy and fun designs' },
  { name: "Charli D'Amelio",        instagram: '@charlidamelio',     birthday: '2004-05-01', picture: 'https://randomuser.me/api/portraits/women/51.jpg', notes: 'Dancing queen, loves simple and cute matching nail sets' },
  { name: "Dixie D'Amelio",         instagram: '@dixiedamelio',      birthday: '2001-08-12', picture: 'https://randomuser.me/api/portraits/women/52.jpg', notes: 'Cool-girl aesthetic, loves neutral and clean nail looks' },
  { name: 'Alix Earle',             instagram: '@alixearle',         birthday: '2001-12-16', picture: 'https://randomuser.me/api/portraits/women/53.jpg', notes: 'GRWM queen — always getting her nails done for content' },
  { name: 'Emma Chamberlain',       instagram: '@emmachamberlain',   birthday: '2001-05-22', picture: 'https://randomuser.me/api/portraits/women/54.jpg', notes: 'Coffee and nails girlie, loves minimal and aesthetic looks' },
  { name: 'Sofia Richie Grainge',   instagram: '@sofiarichie',       birthday: '1998-08-24', picture: 'https://randomuser.me/api/portraits/women/55.jpg', notes: 'Quiet luxury aesthetic, always glazed donut or soft nude' },
  { name: 'Tessa Thompson',         instagram: '@tessathompson_x',   birthday: '1983-10-03', picture: 'https://randomuser.me/api/portraits/women/56.jpg', notes: 'Valkyrie energy — loves bold statement nails for premieres' },
  { name: 'Brie Larson',            instagram: '@brielarson',        birthday: '1989-10-01', picture: 'https://randomuser.me/api/portraits/women/57.jpg', notes: 'Captain Marvel strength — clean and confident nails' },
  { name: 'Zoe Kravitz',            instagram: '@zoeisabellakravitz',birthday: '1988-12-01', picture: 'https://randomuser.me/api/portraits/women/58.jpg', notes: 'Rock royalty, loves edgy minimal nails — often all black' },
  { name: 'America Ferrera',        instagram: '@americaferrera',    birthday: '1984-04-18', picture: 'https://randomuser.me/api/portraits/women/59.jpg', notes: 'Real girl energy, loves approachable and pretty nail art' },
  { name: 'Michelle Yeoh',          instagram: '@michellekyyeoh',    birthday: '1962-08-06', picture: 'https://randomuser.me/api/portraits/women/60.jpg', notes: 'Everything Everywhere glam, loves elegant and powerful looks' },
  { name: 'Awkwafina',              instagram: '@awkwafina',         birthday: '1988-06-02', picture: 'https://randomuser.me/api/portraits/women/61.jpg', notes: 'Comedy queen, loves funny nail art and bold statements' },
  { name: 'Ali Wong',               instagram: '@aliwong',           birthday: '1982-04-19', picture: 'https://randomuser.me/api/portraits/women/62.jpg', notes: 'Hilarious and confident, loves classic reds for stand-up' },
  { name: 'Lana Del Rey',           instagram: '@lanadelrey',        birthday: '1985-06-21', picture: 'https://randomuser.me/api/portraits/women/63.jpg', notes: 'Sadcore glamour, loves vintage reds and dreamy designs' },
  { name: 'Lorde',                  instagram: '@lorde',             birthday: '1996-11-07', picture: 'https://randomuser.me/api/portraits/women/64.jpg', notes: 'Pure Heroine aesthetic, loves unusual and artistic nails' },
  { name: 'Reneé Rapp',             instagram: '@reneerapp',         birthday: '2000-01-10', picture: 'https://randomuser.me/api/portraits/women/65.jpg', notes: 'Mean Girls era — loves pink in every shade possible' },
  { name: 'Dove Cameron',           instagram: '@dovecameron',       birthday: '1996-01-15', picture: 'https://randomuser.me/api/portraits/women/66.jpg', notes: 'Ethereal and romantic, loves soft pastels and pearl accents' },
  { name: 'Sadie Sink',             instagram: '@sadiesink',         birthday: '2002-04-16', picture: 'https://randomuser.me/api/portraits/women/67.jpg', notes: 'Stranger Things chic, loves warm auburn-toned nail art' },
  { name: 'Madelaine Petsch',       instagram: '@madelainepetsch',   birthday: '1994-08-18', picture: 'https://randomuser.me/api/portraits/women/68.jpg', notes: 'Cheryl Blossom vibes — loves cherry red and bold looks' },
  { name: 'Camila Mendes',          instagram: '@camimendes',        birthday: '1994-06-29', picture: 'https://randomuser.me/api/portraits/women/69.jpg', notes: 'Veronica Lodge energy — classic and always sophisticated' },
  { name: 'Lili Reinhart',          instagram: '@lilireinhart',      birthday: '1996-09-13', picture: 'https://randomuser.me/api/portraits/women/70.jpg', notes: 'Betty Cooper sweetness, loves soft and feminine nail looks' },
  { name: 'Rebel Wilson',           instagram: '@rebelwilson',       birthday: '1980-03-02', picture: 'https://randomuser.me/api/portraits/women/71.jpg', notes: 'Pitch Perfect fun, loves colorful and playful nail art' },
  { name: 'Melissa McCarthy',       instagram: '@melissamccarthy',   birthday: '1970-08-26', picture: 'https://randomuser.me/api/portraits/women/72.jpg', notes: 'Comedy legend, loves fun and unpretentious nail looks' },
  { name: 'Sandra Bullock',         instagram: '@sandrabullockofficial', birthday: '1964-07-26', picture: 'https://randomuser.me/api/portraits/women/73.jpg', notes: 'America\'s sweetheart, clean and classic nails always' },
  { name: 'Charlize Theron',        instagram: '@charlizeafrica',    birthday: '1975-08-07', picture: 'https://randomuser.me/api/portraits/women/74.jpg', notes: 'Monster Atomic-level fierce, loves bold statement nails' },
  { name: 'Cate Blanchett',         instagram: '@cateblanchettofficial', birthday: '1969-05-14', picture: 'https://randomuser.me/api/portraits/women/75.jpg', notes: 'Iconic and refined, always impeccably polished and elegant' },
  { name: 'Helen Mirren',           instagram: '@helenmirrenreal',   birthday: '1945-07-26', picture: 'https://randomuser.me/api/portraits/women/76.jpg', notes: 'Dame Helen — loves classic red for events, always graceful' },
  { name: 'Meryl Streep',           instagram: '@merylstreepofficial', birthday: '1949-06-22', picture: 'https://randomuser.me/api/portraits/women/77.jpg', notes: 'The GOAT, loves understated and powerful nail statements' },
  { name: 'Julia Roberts',          instagram: '@juliaroberts',      birthday: '1967-10-28', picture: 'https://randomuser.me/api/portraits/women/78.jpg', notes: 'Pretty Woman energy — always comes in for a classic mani' },
  { name: 'Cher',                   instagram: '@cher',              birthday: '1946-05-20', picture: 'https://randomuser.me/api/portraits/women/79.jpg', notes: 'Do you believe in nail art? Because she does — wild and long' },
  { name: 'Diana Ross',             instagram: '@dianaross',         birthday: '1944-03-26', picture: 'https://randomuser.me/api/portraits/women/80.jpg', notes: 'Supreme elegance — long dramatic nails, always a showstopper' },
  { name: 'Grace Jones',            instagram: '@gracejoneofficial', birthday: '1948-05-19', picture: 'https://randomuser.me/api/portraits/women/81.jpg', notes: 'Avant-garde legend — loves geometric and architectural nails' },
  { name: 'Tina Turner',            instagram: '@tinaturner',        birthday: '1939-11-26', picture: 'https://randomuser.me/api/portraits/women/82.jpg', notes: 'Simply the best — loves powerful bold nails for concerts' },
  { name: 'Patti LaBelle',          instagram: '@mspattilabelle',    birthday: '1944-05-24', picture: 'https://randomuser.me/api/portraits/women/83.jpg', notes: 'Lady Marmalade herself — bejeweled and fabulous always' },
  { name: 'Chaka Khan',             instagram: '@chakakhan',         birthday: '1953-03-23', picture: 'https://randomuser.me/api/portraits/women/84.jpg', notes: 'I\'m every woman — bold, regal, and always fabulous nails' },
  { name: 'Gladys Knight',          instagram: '@therealgladysknight', birthday: '1944-05-28', picture: 'https://randomuser.me/api/portraits/women/85.jpg', notes: 'Midnight Train elegance — classic and dignified always' },
  { name: 'Nicole Scherzinger',     instagram: '@nicolescherzy',     birthday: '1978-06-29', picture: 'https://randomuser.me/api/portraits/women/86.jpg', notes: 'Pussycat Doll fierce, loves long glamorous stiletto nails' },
  { name: 'Lena Waithe',            instagram: '@lenawaithe',        birthday: '1984-05-17', picture: 'https://randomuser.me/api/portraits/women/87.jpg', notes: 'Trailblazer vibes, loves clean masculine-inspired nail looks' },
  { name: 'Taylor Hill',            instagram: '@taylor_hill',       birthday: '1996-03-05', picture: 'https://randomuser.me/api/portraits/women/88.jpg', notes: 'VS Angel, loves soft and feminine nails with clean lines' },
  { name: 'Adriana Lima',           instagram: '@adrianalima',       birthday: '1981-06-12', picture: 'https://randomuser.me/api/portraits/women/89.jpg', notes: 'Supermodel perfection, loves classic and timeless nail looks' },
  { name: 'Heidi Klum',             instagram: '@heidiklum',         birthday: '1973-06-01', picture: 'https://randomuser.me/api/portraits/women/90.jpg', notes: 'Germany\'s Next Top Nail — always fashion-forward and bold' },
  { name: 'Karlie Kloss',           instagram: '@karliekloss',       birthday: '1992-08-05', picture: 'https://randomuser.me/api/portraits/women/91.jpg', notes: 'Kode with Klossy nails — loves clean and tech-chic looks' },
  { name: 'Winnie Harlow',          instagram: '@winnieharlow',      birthday: '1994-07-27', picture: 'https://randomuser.me/api/portraits/women/92.jpg', notes: 'Trailblazer model, loves artistic and unique nail statements' },
  { name: 'Christina Milian',       instagram: '@christinamilian',   birthday: '1981-09-26', picture: 'https://randomuser.me/api/portraits/women/93.jpg', notes: 'Y2K pop queen, loves retro-inspired and vibrant nail art' },
  { name: 'Tayshia Adams',          instagram: '@tayshiaadams',      birthday: '1990-09-04', picture: 'https://randomuser.me/api/portraits/women/94.jpg', notes: 'Bachelorette glam, loves romantic and elegant nail designs' },
  { name: 'Rachel Lindsay',         instagram: '@therachlindsay',    birthday: '1985-04-21', picture: 'https://randomuser.me/api/portraits/women/95.jpg', notes: 'First impression rose — always arrives with stunning nails' },
  { name: 'Nicole Byer',            instagram: '@nicolebyer',        birthday: '1986-08-29', picture: 'https://randomuser.me/api/portraits/women/96.jpg', notes: 'Nailed It! host knows her nails — loves fun and colorful looks' },
  { name: 'Phoebe Robinson',        instagram: '@dopequeenpheebs',   birthday: '1984-09-28', picture: 'https://randomuser.me/api/portraits/women/97.jpg', notes: 'Dope queen, loves bold and empowering nail art' },
  { name: 'Loni Love',              instagram: '@lonilove',          birthday: '1971-07-14', picture: 'https://randomuser.me/api/portraits/women/98.jpg', notes: 'The Real deal — loves glamorous and full nails always' },
  { name: 'Vivica A. Fox',          instagram: '@msvivicafox',       birthday: '1964-07-30', picture: 'https://randomuser.me/api/portraits/women/99.jpg', notes: 'Kill Bill fierce, loves dramatic long nails for any occasion' },
];

const CELEBRITIES_3 = [
  { name: 'Kelly Rowland',           instagram: '@kellyrowland',       birthday: '1981-02-11', picture: 'https://randomuser.me/api/portraits/women/0.jpg',  notes: 'Destiny\'s Child royalty — loves bold gel-x coffin, always VIP' },
  { name: 'Ciara Princess Harris',   instagram: '@ciara',              birthday: '1985-10-25', picture: 'https://randomuser.me/api/portraits/women/1.jpg',  notes: 'Level Up nails — loves chrome and sleek long coffin' },
  { name: 'Ashanti',                 instagram: '@ashanti',            birthday: '1980-10-13', picture: 'https://randomuser.me/api/portraits/women/2.jpg',  notes: 'R&B queen, loves classic glamour and warm jewel tones' },
  { name: 'Brandy Norwood',          instagram: '@4everbrandy',        birthday: '1979-02-11', picture: 'https://randomuser.me/api/portraits/women/3.jpg',  notes: 'Never Say Never nails — loves soft pinks and structured gel' },
  { name: 'Monica Arnold',           instagram: '@monicadenisebrown',  birthday: '1980-10-24', picture: 'https://randomuser.me/api/portraits/women/4.jpg',  notes: 'Angel of Mine vibes — classic and sophisticated every visit' },
  { name: 'H.E.R.',                  instagram: '@hermusicofficial',   birthday: '1997-06-27', picture: 'https://randomuser.me/api/portraits/women/5.jpg',  notes: 'Guitar goddess, loves dark moody tones and understated art' },
  { name: 'Jhené Aiko',              instagram: '@jheneaiko',          birthday: '1988-03-16', picture: 'https://randomuser.me/api/portraits/women/6.jpg',  notes: 'Trip aestetic — loves sage green, lavender, and celestial art' },
  { name: 'Summer Walker',           instagram: '@summerwalker',       birthday: '1996-04-11', picture: 'https://randomuser.me/api/portraits/women/7.jpg',  notes: 'Over It but her nails aren\'t — loves extra long and dramatic' },
  { name: 'Chlöe Bailey',            instagram: '@chloebailey',        birthday: '2001-07-01', picture: 'https://randomuser.me/api/portraits/women/8.jpg',  notes: 'Have Mercy on my nails — bold, fierce, always a statement' },
  { name: 'Kehlani',                 instagram: '@kehlani',            birthday: '1995-04-24', picture: 'https://randomuser.me/api/portraits/women/9.jpg',  notes: 'Honey vibes — warm tones, medium almond, always radiant' },
  { name: 'Ari Lennox',              instagram: '@arilennox',          birthday: '1991-03-26', picture: 'https://randomuser.me/api/portraits/women/10.jpg', notes: 'Age/Sex/Location: nail salon — loves soft nudes and gel manis' },
  { name: 'Erykah Badu',             instagram: '@erykahbadu',         birthday: '1971-02-26', picture: 'https://randomuser.me/api/portraits/women/11.jpg', notes: 'On & On — loves mystical nail art and earthy gem tones' },
  { name: 'India.Arie',              instagram: '@indiaarie',          birthday: '1975-10-03', picture: 'https://randomuser.me/api/portraits/women/12.jpg', notes: 'I Am Not My Hair but I am my nails — loves natural nail art' },
  { name: 'Jazmine Sullivan',        instagram: '@jazminesullivan',    birthday: '1987-04-09', picture: 'https://randomuser.me/api/portraits/women/13.jpg', notes: 'Heaux Tales nails — bold and unapologetic, loves deep reds' },
  { name: 'Tinashe Kachingwe',       instagram: '@tinashe',            birthday: '1993-02-06', picture: 'https://randomuser.me/api/portraits/women/14.jpg', notes: '2 On nail art — loves futuristic and sleek modern designs' },
  { name: 'Teyana Taylor',           instagram: '@teyanataylor',       birthday: '1990-12-10', picture: 'https://randomuser.me/api/portraits/women/15.jpg', notes: 'Also: loves extra long nails, always photos them post-visit' },
  { name: 'Ella Mai',                instagram: '@ellamai',            birthday: '1994-11-03', picture: 'https://randomuser.me/api/portraits/women/16.jpg', notes: 'Boo\'d Up nails — loves soft pinks and feminine almond shape' },
  { name: 'Queen Naija',             instagram: '@queennaija',         birthday: '1995-10-17', picture: 'https://randomuser.me/api/portraits/women/17.jpg', notes: 'Pack Lite nails — loves trendy designs, posts every visit on YT' },
  { name: 'Keri Hilson',             instagram: '@kerihilson',         birthday: '1982-04-05', picture: 'https://randomuser.me/api/portraits/women/18.jpg', notes: 'Knock You Down style — loves bold coffin and striking nail art' },
  { name: 'Mýa Harrison',            instagram: '@myasimon',           birthday: '1979-10-10', picture: 'https://randomuser.me/api/portraits/women/19.jpg', notes: 'Case of the Ex nails — retro glam, loves classic reds and French' },
  { name: 'Amerie Rogers',           instagram: '@ameriex',            birthday: '1980-01-12', picture: 'https://randomuser.me/api/portraits/women/20.jpg', notes: 'Why Don\'t We Fall in Love vibes — romantic and feminine always' },
  { name: 'Kelela Mizanekristos',    instagram: '@kelela',             birthday: '1983-12-15', picture: 'https://randomuser.me/api/portraits/women/21.jpg', notes: 'Raven dark aesthetic, loves black with holographic accents' },
  { name: 'Ravyn Lenae',             instagram: '@ravynlenae',         birthday: '1999-08-13', picture: 'https://randomuser.me/api/portraits/women/22.jpg', notes: 'Hypnos energy — dreamy pastel and iridescent nail art' },
  { name: 'Amber Mark',              instagram: '@amber_mark',         birthday: '1994-10-10', picture: 'https://randomuser.me/api/portraits/women/23.jpg', notes: 'Generous nail lover — always tries the most intricate designs' },
  { name: 'Pink',                    instagram: '@pink',               birthday: '1979-09-08', picture: 'https://randomuser.me/api/portraits/women/24.jpg', notes: 'Just Give Me a Reason to get bold nails — loves edgy punk art' },
  { name: 'Christina Aguilera',      instagram: '@xtina',              birthday: '1980-12-18', picture: 'https://randomuser.me/api/portraits/women/25.jpg', notes: 'Beautiful nails — long glamorous coffin, loves crystal accents' },
  { name: 'Gwen Stefani',            instagram: '@gwenstefani',        birthday: '1969-10-03', picture: 'https://randomuser.me/api/portraits/women/26.jpg', notes: 'Hollaback girl but for nails — loves bold prints and funky designs' },
  { name: 'Adele',                   instagram: '@adele',              birthday: '1988-05-05', picture: 'https://randomuser.me/api/portraits/women/27.jpg', notes: 'Rolling in the Deep nail art — classic, powerful, always elegant' },
  { name: 'Lily Allen',              instagram: '@lilyallen',          birthday: '1985-05-02', picture: 'https://randomuser.me/api/portraits/women/28.jpg', notes: 'Smile energy — fun and cheeky nail designs, loves pastel pop art' },
  { name: 'Nelly Furtado',           instagram: '@nellyfurtado',       birthday: '1978-12-02', picture: 'https://randomuser.me/api/portraits/women/29.jpg', notes: 'I\'m Like a Bird nails — free-spirited and nature-inspired designs' },
  { name: 'Demi Lovato',             instagram: '@ddlovato',           birthday: '1992-08-20', picture: 'https://randomuser.me/api/portraits/women/30.jpg', notes: 'Sorry Not Sorry nails — loves bold statement looks and deep tones' },
  { name: 'Miley Cyrus',             instagram: '@mileycyrus',         birthday: '1992-11-23', picture: 'https://randomuser.me/api/portraits/women/31.jpg', notes: 'Flowers nails — reinvents look every visit, always wild and fun' },
  { name: 'Hilary Duff',             instagram: '@hilaryduff',         birthday: '1987-09-28', picture: 'https://randomuser.me/api/portraits/women/32.jpg', notes: 'Lizzie McGuire grown up — loves clean nude sets and soft pinks' },
  { name: 'Kelly Clarkson',          instagram: '@kellyclarkson',      birthday: '1982-04-24', picture: 'https://randomuser.me/api/portraits/women/33.jpg', notes: 'Since U Been Gone she\'s been here every month — loves reds' },
  { name: 'Hayley Williams',         instagram: '@yelyahwilliams',     birthday: '1988-12-27', picture: 'https://randomuser.me/api/portraits/women/34.jpg', notes: 'Paramore punk meets glam — loves fiery orange and bold nail art' },
  { name: 'Anne-Marie',              instagram: '@annemarie',          birthday: '1991-04-07', picture: 'https://randomuser.me/api/portraits/women/35.jpg', notes: '2002 aesthetic — loves Y2K-inspired pastel and fun nail designs' },
  { name: 'Becky G',                 instagram: '@iambeckyg',          birthday: '1997-03-02', picture: 'https://randomuser.me/api/portraits/women/36.jpg', notes: 'Shower power nails — loves vibrant Latina-inspired nail art' },
  { name: 'Karol G',                 instagram: '@karolg',             birthday: '1991-02-14', picture: 'https://randomuser.me/api/portraits/women/37.jpg', notes: 'Bichota nails — fierce and fabulous, always extra-long coffin' },
  { name: 'Natti Natasha',           instagram: '@nattinatasha',       birthday: '1986-12-10', picture: 'https://randomuser.me/api/portraits/women/38.jpg', notes: 'No Floor nails — loves tropical and vibrant nail art designs' },
  { name: 'Ellie Goulding',          instagram: '@elliegoulding',      birthday: '1986-12-30', picture: 'https://randomuser.me/api/portraits/women/39.jpg', notes: 'Lights nails — loves ethereal glow-inspired and soft nail art' },
  { name: 'Meghan Trainor',          instagram: '@meghan_trainor',     birthday: '1993-12-22', picture: 'https://randomuser.me/api/portraits/women/40.jpg', notes: 'All About That Base Coat — loves cute pastel and fun seasonal designs' },
  { name: 'Mitski Miyawaki',         instagram: '@mitskileaks',        birthday: '1990-09-27', picture: 'https://randomuser.me/api/portraits/women/41.jpg', notes: 'Be the Cowboy nails — minimalist but deeply intentional art' },
  { name: 'Brandi Carlile',          instagram: '@brandicarlile',      birthday: '1981-06-01', picture: 'https://randomuser.me/api/portraits/women/42.jpg', notes: 'The Story nails — loves warm earthy tones and folk-inspired designs' },
  { name: 'Sheryl Crow',             instagram: '@sherylcrow',         birthday: '1962-02-11', picture: 'https://randomuser.me/api/portraits/women/43.jpg', notes: 'All I Wanna Do nails — classic California cool, loves nudes and sun' },
  { name: 'Alanis Morissette',       instagram: '@alanis',             birthday: '1974-06-01', picture: 'https://randomuser.me/api/portraits/women/44.jpg', notes: 'Ironic nail art — loves grunge-meets-feminine dark tones' },
  { name: 'Jewel Kilcher',           instagram: '@jewel',              birthday: '1974-05-23', picture: 'https://randomuser.me/api/portraits/women/45.jpg', notes: 'Hands nails — loves natural and delicate minimalist nail looks' },
  { name: 'Fiona Apple',             instagram: '@fionaaple',          birthday: '1977-09-13', picture: 'https://randomuser.me/api/portraits/women/46.jpg', notes: 'Criminal nail art — dark and artistic, always unique designs' },
  { name: 'Simone Biles',            instagram: '@simonebiles',        birthday: '1997-03-14', picture: 'https://randomuser.me/api/portraits/women/47.jpg', notes: 'GOAT nails — loves patriotic reds and golds for competition season' },
  { name: "Sha'Carri Richardson",    instagram: '@shacaririchardson',  birthday: '2000-03-25', picture: 'https://randomuser.me/api/portraits/women/48.jpg', notes: 'Fastest woman alive, also fastest to pick a nail design — VIP' },
  { name: 'Naomi Osaka',             instagram: '@naomiosaka',         birthday: '1997-10-16', picture: 'https://randomuser.me/api/portraits/women/49.jpg', notes: 'Grand Slam nails — cool and understated, loves minimalist designs' },
  { name: 'Serena Williams',         instagram: '@serenawilliams',     birthday: '1981-09-26', picture: 'https://randomuser.me/api/portraits/women/50.jpg', notes: 'GOAT of nails too — always comes in with a fierce inspiration photo' },
  { name: 'Venus Williams',          instagram: '@venuswilliams',      birthday: '1980-06-17', picture: 'https://randomuser.me/api/portraits/women/51.jpg', notes: 'Fashion-forward and bold, loves avant-garde nail art designs' },
  { name: 'Megan Rapinoe',           instagram: '@mrapinoe',           birthday: '1985-07-05', picture: 'https://randomuser.me/api/portraits/women/52.jpg', notes: 'Champions show up with great nails — loves vibrant rainbow designs' },
  { name: 'Alex Morgan',             instagram: '@alexmorgan13',       birthday: '1989-07-02', picture: 'https://randomuser.me/api/portraits/women/53.jpg', notes: 'Soccer star nails — loves clean and sporty French tip look' },
  { name: 'Allyson Felix',           instagram: '@allysonfelix',       birthday: '1985-11-18', picture: 'https://randomuser.me/api/portraits/women/54.jpg', notes: 'Sprint queen — loves subtle gold accents for race day nails' },
  { name: 'Katie Ledecky',           instagram: '@katieledecky',       birthday: '1997-03-17', picture: 'https://randomuser.me/api/portraits/women/55.jpg', notes: 'Gold medal nails — loves patriotic designs during Olympic season' },
  { name: 'Misty Copeland',          instagram: '@mistyonpointe',      birthday: '1982-09-10', picture: 'https://randomuser.me/api/portraits/women/56.jpg', notes: 'Ballet principal nails — loves delicate rose gold and blush tones' },
  { name: 'Gabby Douglas',           instagram: '@gabbydouglas',       birthday: '1995-12-31', picture: 'https://randomuser.me/api/portraits/women/57.jpg', notes: 'Flying Squirrel nails — loves fun and colorful gymnastics-ready looks' },
  { name: 'Laurie Hernandez',        instagram: '@lauriehernandez',    birthday: '2000-06-09', picture: 'https://randomuser.me/api/portraits/women/58.jpg', notes: 'I Got This nails — sparkly and fun, always brings great energy' },
  { name: 'Sunisa Lee',              instagram: '@sunisalee_',         birthday: '2003-03-09', picture: 'https://randomuser.me/api/portraits/women/59.jpg', notes: 'Olympic gold nails — loves elegant and precise nail art designs' },
  { name: 'Chloe Kim',               instagram: '@chloekimsnow',       birthday: '2000-04-23', picture: 'https://randomuser.me/api/portraits/women/60.jpg', notes: 'Halfpipe queen nails — loves cool and edgy snowboard-inspired art' },
  { name: 'Ronda Rousey',            instagram: '@rondarousey',        birthday: '1987-02-01', picture: 'https://randomuser.me/api/portraits/women/61.jpg', notes: 'Rowdy nails — fierce and strong, loves bold dark warrior tones' },
  { name: 'Amanda Nunes',            instagram: '@amanda_leoa',        birthday: '1988-05-30', picture: 'https://randomuser.me/api/portraits/women/62.jpg', notes: 'Lioness nails — powerful and bold, loves Brazilian-inspired designs' },
  { name: 'Bella Hadid',             instagram: '@bellahadid',         birthday: '1996-10-09', picture: 'https://randomuser.me/api/portraits/women/63.jpg', notes: 'Model of the year nails — loves edgy dark tones and sharp stiletto' },
  { name: 'Gigi Hadid',              instagram: '@gigihadid',          birthday: '1995-04-23', picture: 'https://randomuser.me/api/portraits/women/64.jpg', notes: 'Runway-ready nails — clean and sophisticated, loves classic looks' },
  { name: 'Kendall Jenner',          instagram: '@kendalljenner',      birthday: '1995-11-03', picture: 'https://randomuser.me/api/portraits/women/65.jpg', notes: 'Supermodel nails — loves the no-makeup nail look, very minimalist' },
  { name: 'Hailey Bieber',           instagram: '@haileybieber',       birthday: '1996-11-22', picture: 'https://randomuser.me/api/portraits/women/66.jpg', notes: 'Rhode Skin nails — invented glazed donut look, always a trendsetter' },
  { name: 'Rosie Huntington-Whiteley', instagram: '@rosiehw',          birthday: '1987-04-18', picture: 'https://randomuser.me/api/portraits/women/67.jpg', notes: 'Rose London nails — loves ultra-chic quiet luxury nail looks' },
  { name: 'Miranda Kerr',            instagram: '@mirandakerr',        birthday: '1983-04-20', picture: 'https://randomuser.me/api/portraits/women/68.jpg', notes: 'Kora Organics nails — loves natural and wholesome nail designs' },
  { name: 'Candice Swanepoel',       instagram: '@candiceswanepoel',   birthday: '1988-10-20', picture: 'https://randomuser.me/api/portraits/women/69.jpg', notes: 'VS Angel nails — loves soft pink ombre and delicate lace designs' },
  { name: 'Alessandra Ambrosio',     instagram: '@alessandraambrosio', birthday: '1981-04-11', picture: 'https://randomuser.me/api/portraits/women/70.jpg', notes: 'Brazilian bombshell nails — loves warm bronze and tropical art' },
  { name: 'Joan Smalls',             instagram: '@joansmalls',         birthday: '1988-07-11', picture: 'https://randomuser.me/api/portraits/women/71.jpg', notes: 'Puerto Rican pride nails — loves vibrant and high-fashion designs' },
  { name: 'Jourdan Dunn',            instagram: '@jourdan_dunn',       birthday: '1990-08-03', picture: 'https://randomuser.me/api/portraits/women/72.jpg', notes: 'London cool nails — loves minimal and editorial nail looks' },
  { name: 'Duckie Thot',             instagram: '@duckiethot',         birthday: '1995-11-13', picture: 'https://randomuser.me/api/portraits/women/73.jpg', notes: 'Dark and stunning nails — loves deep jewel tones and crystal art' },
  { name: 'Anok Yai',                instagram: '@anokyai',            birthday: '1997-06-05', picture: 'https://randomuser.me/api/portraits/women/74.jpg', notes: 'Chanel runway nails — fierce and editorial, always high-fashion' },
  { name: 'Precious Lee',            instagram: '@precious.lee.model', birthday: '1992-05-04', picture: 'https://randomuser.me/api/portraits/women/75.jpg', notes: 'Plus-size supermodel nails — loves bold and body-positive designs' },
  { name: 'Barbara Palvin',          instagram: '@barbarapalvin',      birthday: '1993-08-08', picture: 'https://randomuser.me/api/portraits/women/76.jpg', notes: 'Hungarian beauty nails — loves romantic and feminine gel manis' },
  { name: 'Angela Bassett',          instagram: '@_angelabassett',     birthday: '1958-08-16', picture: 'https://randomuser.me/api/portraits/women/77.jpg', notes: 'What\'s Love Got to Do with Nails? — fierce and regal always' },
  { name: 'Gabrielle Union',         instagram: '@gabunion',           birthday: '1972-10-29', picture: 'https://randomuser.me/api/portraits/women/78.jpg', notes: 'Bring It On nails — loves fierce and polished glamorous looks' },
  { name: 'Regina King',             instagram: '@iamreginaking',      birthday: '1971-01-15', picture: 'https://randomuser.me/api/portraits/women/79.jpg', notes: 'Oscar winner nails — powerful and dignified, always impeccable' },
  { name: 'Octavia Spencer',         instagram: '@octaviaspencer',     birthday: '1970-05-25', picture: 'https://randomuser.me/api/portraits/women/80.jpg', notes: 'The Help nails — warm and approachable, loves classic Southern glam' },
  { name: 'Niecy Nash',              instagram: '@niecynash',          birthday: '1970-02-23', picture: 'https://randomuser.me/api/portraits/women/81.jpg', notes: 'Uproarious and glamorous, loves long dramatic nails for TV appearances' },
  { name: 'Tracee Ellis Ross',       instagram: '@traceeellisross',    birthday: '1972-10-29', picture: 'https://randomuser.me/api/portraits/women/82.jpg', notes: 'Black-ish nails — fashion icon, always brings editorial inspiration' },
  { name: 'Yara Shahidi',            instagram: '@yarashahidi',        birthday: '2000-02-10', picture: 'https://randomuser.me/api/portraits/women/83.jpg', notes: 'Grown-ish nails — intellectual cool girl, loves subtle artsy designs' },
  { name: 'Amandla Stenberg',        instagram: '@amandlastenberg',    birthday: '1998-10-23', picture: 'https://randomuser.me/api/portraits/women/84.jpg', notes: 'The Hate U Give nails — bold and political, loves statement designs' },
  { name: 'Storm Reid',              instagram: '@stormreid',          birthday: '2003-07-01', picture: 'https://randomuser.me/api/portraits/women/85.jpg', notes: 'Euphoria nails — Gen Z icon, always shows up with wild inspiration' },
  { name: 'Danai Gurira',            instagram: '@danaigurira',        birthday: '1978-02-14', picture: 'https://randomuser.me/api/portraits/women/86.jpg', notes: 'Okoye nails — fierce warrior energy, loves bold and powerful looks' },
  { name: 'Letitia Wright',          instagram: '@letitiawright',      birthday: '1993-10-31', picture: 'https://randomuser.me/api/portraits/women/87.jpg', notes: 'Shuri nails — tech-forward and creative, loves futuristic nail art' },
  { name: 'Michaela Coel',           instagram: '@michaelacoelofficial', birthday: '1987-10-01', picture: 'https://randomuser.me/api/portraits/women/88.jpg', notes: 'I May Destroy You (with nail art) — dark and artistic always' },
  { name: 'Jodie Turner-Smith',      instagram: '@jodiesmith',         birthday: '1986-09-07', picture: 'https://randomuser.me/api/portraits/women/89.jpg', notes: 'Queen & Slim nails — strikingly beautiful, loves bold jewel tones' },
  { name: 'Naomie Harris',           instagram: '@naomieharris',       birthday: '1976-09-06', picture: 'https://randomuser.me/api/portraits/women/90.jpg', notes: 'Bond girl nails — sophisticated and sleek, loves deep vampy colors' },
  { name: 'Thandiwe Newton',         instagram: '@thandiwenewton',     birthday: '1972-11-06', picture: 'https://randomuser.me/api/portraits/women/91.jpg', notes: 'Westworld nails — complex and beautiful, loves rich dark designs' },
  { name: 'Gemma Chan',              instagram: '@gemma_chan',          birthday: '1982-11-29', picture: 'https://randomuser.me/api/portraits/women/92.jpg', notes: 'Crazy Rich nails — loves elegant minimal and ultra-luxe designs' },
  { name: 'Cynthia Erivo',           instagram: '@cynthiaerivo',       birthday: '1987-01-08', picture: 'https://randomuser.me/api/portraits/women/93.jpg', notes: 'EGOT nails — theatrical and stunning, always an artistic vision' },
  { name: 'Jennifer Hudson',         instagram: '@iamjhud',            birthday: '1981-09-12', picture: 'https://randomuser.me/api/portraits/women/94.jpg', notes: 'Dreamgirls nails — powerhouse glamour, loves dazzling crystal sets' },
  { name: 'Fantasia Barrino',        instagram: '@tasiasword',         birthday: '1984-06-30', picture: 'https://randomuser.me/api/portraits/women/95.jpg', notes: 'I Believe nails — soulful and passionate, loves bold warm tones' },
  { name: 'Jordin Sparks',           instagram: '@jordinsparks',       birthday: '1989-12-22', picture: 'https://randomuser.me/api/portraits/women/96.jpg', notes: 'Tattoo nails — sweet and sparkly, loves delicate and fun designs' },
  { name: 'Jessica Simpson',         instagram: '@jessicasimpson',     birthday: '1980-07-10', picture: 'https://randomuser.me/api/portraits/women/97.jpg', notes: 'Open Season nails — bubbly and glamorous, loves glitter and pink' },
  { name: 'Lindsay Lohan',           instagram: '@lindsaylohan',       birthday: '1986-07-02', picture: 'https://randomuser.me/api/portraits/women/98.jpg', notes: 'Mean Girls nails — loves classic Plastics pink and bold designs' },
  { name: 'Vanessa Hudgens',         instagram: '@vanessahudgens',     birthday: '1988-12-14', picture: 'https://randomuser.me/api/portraits/women/99.jpg', notes: 'Coachella nails — boho chic, loves festival-inspired floral designs' },
];

const CELEBRITIES_4 = [
  { name: 'Gwyneth Paltrow',         instagram: '@gwynethpaltrow',     birthday: '1972-09-27', picture: 'https://randomuser.me/api/portraits/women/0.jpg',  notes: 'Goop nails — loves clean wellness-inspired pale pink and nude' },
  { name: 'Cameron Diaz',            instagram: '@camerondiaz',        birthday: '1972-08-30', picture: 'https://randomuser.me/api/portraits/women/1.jpg',  notes: 'There\'s Something About Nails — natural beach girl, loves nudes' },
  { name: 'Drew Barrymore',          instagram: '@drewbarrymore',      birthday: '1975-02-22', picture: 'https://randomuser.me/api/portraits/women/2.jpg',  notes: 'Never Been Kissed but always gets nails done — loves fun pastels' },
  { name: 'Angelina Jolie',          instagram: '@angelinajolie',      birthday: '1975-06-04', picture: 'https://randomuser.me/api/portraits/women/3.jpg',  notes: 'Maleficent nails — loves dark dramatic tones and sharp shapes' },
  { name: 'Natalie Portman',         instagram: '@natalieportman',     birthday: '1981-06-09', picture: 'https://randomuser.me/api/portraits/women/4.jpg',  notes: 'Black Swan nails — loves dramatic contrast and precise nail art' },
  { name: 'Keira Knightley',         instagram: '@keiraknightley',     birthday: '1985-03-26', picture: 'https://randomuser.me/api/portraits/women/5.jpg',  notes: 'Pride & Nails — British elegance, loves soft natural look always' },
  { name: 'Kate Winslet',            instagram: '@katewinsletofficial', birthday: '1975-10-05', picture: 'https://randomuser.me/api/portraits/women/6.jpg', notes: 'Titanic nails — classic and timeless, loves soft rose and cream' },
  { name: 'Anne Hathaway',           instagram: '@annehathaway',       birthday: '1982-11-12', picture: 'https://randomuser.me/api/portraits/women/7.jpg',  notes: 'Devil Wears Nails — high fashion and impeccable, always stunning' },
  { name: 'Amy Adams',               instagram: '@offtherecord_ama',   birthday: '1974-08-20', picture: 'https://randomuser.me/api/portraits/women/8.jpg',  notes: 'Enchanted nails — princess energy, loves fairy-tale inspired looks' },
  { name: 'Jennifer Lawrence',       instagram: '@jenniferlawerence',  birthday: '1990-08-15', picture: 'https://randomuser.me/api/portraits/women/9.jpg',  notes: 'Hunger Games nails — loves bold and survivalist-inspired designs' },
  { name: 'Emma Stone',              instagram: '@emmastoneofficial',  birthday: '1988-11-06', picture: 'https://randomuser.me/api/portraits/women/10.jpg', notes: 'La La Land nails — loves vintage Hollywood glam and pastel art' },
  { name: 'Kristen Stewart',         instagram: '@kstewart',           birthday: '1990-04-09', picture: 'https://randomuser.me/api/portraits/women/11.jpg', notes: 'Twilight nails — cool and understated, loves dark emo-inspired art' },
  { name: 'Lily James',              instagram: '@lilyjames',          birthday: '1989-04-05', picture: 'https://randomuser.me/api/portraits/women/12.jpg', notes: 'Cinderella nails — loves romantic soft pink and delicate florals' },
  { name: 'Dakota Johnson',          instagram: '@dakotajohnson',      birthday: '1989-10-04', picture: 'https://randomuser.me/api/portraits/women/13.jpg', notes: 'Fifty Shades of Nails — loves sultry dark tones and minimal art' },
  { name: 'Elle Fanning',            instagram: '@ellefanning',        birthday: '1998-04-09', picture: 'https://randomuser.me/api/portraits/women/14.jpg', notes: 'Maleficent\'s daughter nails — ethereal and dreamy, loves pastels' },
  { name: 'Chloe Grace Moretz',      instagram: '@chloegmoretz',       birthday: '1997-02-10', picture: 'https://randomuser.me/api/portraits/women/15.jpg', notes: 'Hit-Girl nails — loves edgy and bold mixed with girlie pink' },
  { name: 'Chrissy Teigen',          instagram: '@chrissyteigen',      birthday: '1985-11-30', picture: 'https://randomuser.me/api/portraits/women/16.jpg', notes: 'Cravings nails — loves fun foodie-inspired designs and bright colors' },
  { name: 'Oprah Winfrey',           instagram: '@oprah',              birthday: '1954-01-29', picture: 'https://randomuser.me/api/portraits/women/17.jpg', notes: 'You get a nail appointment! — VIP, always books the full treatment' },
  { name: 'Gayle King',              instagram: '@gayleking',          birthday: '1954-12-28', picture: 'https://randomuser.me/api/portraits/women/18.jpg', notes: 'CBS Morning nails — polished and professional, loves classic looks' },
  { name: 'Robin Roberts',           instagram: '@robinrobertsgma',    birthday: '1960-11-23', picture: 'https://randomuser.me/api/portraits/women/19.jpg', notes: 'GMA nails — warm and inspiring, loves patriotic and bright designs' },
  { name: 'Whoopi Goldberg',         instagram: '@whoopigoldberg',     birthday: '1955-11-13', picture: 'https://randomuser.me/api/portraits/women/20.jpg', notes: 'Sister Act nails — fun and holy, loves vibrant and joyful designs' },
  { name: 'Kelly Ripa',              instagram: '@kellyripa',          birthday: '1970-10-02', picture: 'https://randomuser.me/api/portraits/women/21.jpg', notes: 'Live nails — bubbly and energetic, loves cheerful seasonal designs' },
  { name: 'Rachael Ray',             instagram: '@rachaelray',         birthday: '1968-08-25', picture: 'https://randomuser.me/api/portraits/women/22.jpg', notes: '30 Minute Mani — loves quick gel polish change, always friendly' },
  { name: 'Padma Lakshmi',           instagram: '@padmalakshmi',       birthday: '1970-09-01', picture: 'https://randomuser.me/api/portraits/women/23.jpg', notes: 'Top Chef nails — loves rich spice-toned jewel colors and elegance' },
  { name: 'Martha Stewart',          instagram: '@marthastewart48',    birthday: '1941-08-03', picture: 'https://randomuser.me/api/portraits/women/24.jpg', notes: 'It\'s a Good Thing — loves perfectly clean French tips, very precise' },
  { name: 'Jane Fonda',              instagram: '@janefonda',          birthday: '1937-12-21', picture: 'https://randomuser.me/api/portraits/women/25.jpg', notes: 'Workout nails — timeless activism, loves classic red and bold colors' },
  { name: 'Dolly Parton',            instagram: '@dollyparton',        birthday: '1946-01-19', picture: 'https://randomuser.me/api/portraits/women/26.jpg', notes: 'I Will Always Love Nails — long sparkly acrylics, absolute icon' },
  { name: 'Reba McEntire',           instagram: '@reba',               birthday: '1955-03-28', picture: 'https://randomuser.me/api/portraits/women/27.jpg', notes: 'Queen of Country nails — loves classic red and rhinestone designs' },
  { name: 'Faith Hill',              instagram: '@faithhill',          birthday: '1967-09-21', picture: 'https://randomuser.me/api/portraits/women/28.jpg', notes: 'This Kiss nails — romantic and country glam, loves soft warm tones' },
  { name: 'Trisha Yearwood',         instagram: '@trishayearwood',     birthday: '1964-09-19', picture: 'https://randomuser.me/api/portraits/women/29.jpg', notes: 'She\'s in Love with Nails — loves warm earthy and Southern glam' },
  { name: 'Kelsea Ballerini',        instagram: '@kelseaballerini',    birthday: '1993-09-12', picture: 'https://randomuser.me/api/portraits/women/30.jpg', notes: 'Cowboys and nails — loves sparkly country-pop inspired designs' },
  { name: 'Maren Morris',            instagram: '@marenmorris',        birthday: '1990-04-10', picture: 'https://randomuser.me/api/portraits/women/31.jpg', notes: 'GIRL nails — loves modern country girl aesthetic and warm tones' },
  { name: 'Stevie Nicks',            instagram: '@stevienicks',        birthday: '1948-05-26', picture: 'https://randomuser.me/api/portraits/women/32.jpg', notes: 'Edge of Seventeen nails — loves mystical bohemian and lace designs' },
  { name: 'Debbie Harry',            instagram: '@debblondie',         birthday: '1945-07-01', picture: 'https://randomuser.me/api/portraits/women/33.jpg', notes: 'Blondie nails — punk rock glam, loves bold and iconic nail art' },
  { name: 'Joan Jett',               instagram: '@joanjett',           birthday: '1958-09-22', picture: 'https://randomuser.me/api/portraits/women/34.jpg', notes: 'I Love Rock\'n\'Roll nails — pure black, bold, absolute rock legend' },
  { name: 'Pat Benatar',             instagram: '@patbenatar',         birthday: '1953-01-10', picture: 'https://randomuser.me/api/portraits/women/35.jpg', notes: 'Hit Me with Your Best Shot nails — loves fierce dark rock glam' },
  { name: 'Bonnie Raitt',            instagram: '@bonnieraitt',        birthday: '1949-11-08', picture: 'https://randomuser.me/api/portraits/women/36.jpg', notes: 'Something to Talk About nails — loves warm earthy blues and reds' },
  { name: 'Melissa Etheridge',       instagram: '@melissaetheridge',   birthday: '1961-05-29', picture: 'https://randomuser.me/api/portraits/women/37.jpg', notes: 'Come to My Window nails — loves raw and authentic dark nail looks' },
  { name: 'Norah Jones',             instagram: '@norahjonesmusic',    birthday: '1979-03-30', picture: 'https://randomuser.me/api/portraits/women/38.jpg', notes: 'Come Away with Nails — loves jazzy warm tones and understated art' },
  { name: 'Sade Adu',                instagram: '@sadeband',           birthday: '1959-01-16', picture: 'https://randomuser.me/api/portraits/women/39.jpg', notes: 'Smooth Operator nails — effortlessly elegant, loves classic reds' },
  { name: 'Björk',                   instagram: '@bjork',              birthday: '1965-11-21', picture: 'https://randomuser.me/api/portraits/women/40.jpg', notes: 'Human Behavior nails — other-worldly and avant-garde always' },
  { name: 'PJ Harvey',               instagram: '@pollyjeanharvey',    birthday: '1969-10-09', picture: 'https://randomuser.me/api/portraits/women/41.jpg', notes: 'Stories of Dark nails — raw and poetic, loves dark artistic designs' },
  { name: 'Queen Latifah',           instagram: '@queenlatifah',       birthday: '1970-03-18', picture: 'https://randomuser.me/api/portraits/women/42.jpg', notes: 'U.N.I.T.Y. nails — powerful and regal, loves bold statement looks' },
  { name: 'Eve Jeffers Cooper',      instagram: '@therealeve',         birthday: '1978-11-10', picture: 'https://randomuser.me/api/portraits/women/43.jpg', notes: 'Gotta Man nails — fierce pitbull energy, loves wild and bold art' },
  { name: 'Da Brat',                 instagram: '@dabrat',             birthday: '1974-04-14', picture: 'https://randomuser.me/api/portraits/women/44.jpg', notes: 'Funkdafied nails — loves funky vibrant and energetic nail designs' },
  { name: 'Kandi Burruss',           instagram: '@kandi',              birthday: '1976-05-17', picture: 'https://randomuser.me/api/portraits/women/45.jpg', notes: 'Don\'t Think I\'m Not nails — boss energy, loves luxe and glamorous' },
  { name: 'NeNe Leakes',             instagram: '@neneleakes',         birthday: '1967-12-13', picture: 'https://randomuser.me/api/portraits/women/46.jpg', notes: 'I\'m very rich nails — extra-long, bejeweled, never subtle, VIP' },
  { name: 'Kenya Moore',             instagram: '@kenyamoore',         birthday: '1970-01-24', picture: 'https://randomuser.me/api/portraits/women/47.jpg', notes: 'Gone with the Nails — loves glamorous twirl-worthy nail designs' },
  { name: 'Porsha Williams',         instagram: '@porsha4real',        birthday: '1981-06-22', picture: 'https://randomuser.me/api/portraits/women/48.jpg', notes: 'Going to the Underground nails — fierce and fabulous always VIP' },
  { name: 'Sherri Shepherd',         instagram: '@sherrieshepherd',    birthday: '1967-04-22', picture: 'https://randomuser.me/api/portraits/women/49.jpg', notes: 'View from the Nail Salon — loves fun bright colors and designs' },
  { name: 'Jada Pinkett Smith',      instagram: '@jadapinkettsmith',   birthday: '1971-09-18', picture: 'https://randomuser.me/api/portraits/women/50.jpg', notes: 'Red Table Nails — loves meaningful and intentional nail art' },
  { name: 'Toni Braxton',            instagram: '@tonibraxton',        birthday: '1967-10-07', picture: 'https://randomuser.me/api/portraits/women/51.jpg', notes: 'Un-Break My Nails — loves sultry and romantic deep toned sets' },
  { name: 'Leona Lewis',             instagram: '@leonalewis',         birthday: '1985-04-03', picture: 'https://randomuser.me/api/portraits/women/52.jpg', notes: 'Bleeding Love nails — loves soft romantic and heartfelt designs' },
  { name: 'Alexandra Burke',         instagram: '@alexandraburke',     birthday: '1988-08-25', picture: 'https://randomuser.me/api/portraits/women/53.jpg', notes: 'Hallelujah nails — loves gospel-inspired gold and divine designs' },
  { name: 'Nia Long',                instagram: '@nialong',            birthday: '1970-10-30', picture: 'https://randomuser.me/api/portraits/women/54.jpg', notes: 'Love Jones nails — timeless and beautiful, loves classic warm tones' },
  { name: 'Sanaa Lathan',            instagram: '@sanaakukan',         birthday: '1971-09-19', picture: 'https://randomuser.me/api/portraits/women/55.jpg', notes: 'Love and Basketball nails — loves sporty-chic and elegant combos' },
  { name: 'Lauren London',           instagram: '@laurenlondon',       birthday: '1984-12-05', picture: 'https://randomuser.me/api/portraits/women/56.jpg', notes: 'ATL nails — timeless beauty, loves clean and elegant nail designs' },
  { name: 'Meagan Good',             instagram: '@meagansgood',        birthday: '1981-08-08', picture: 'https://randomuser.me/api/portraits/women/57.jpg', notes: 'Think Like a Man nails — loves polished and glamorous bold looks' },
  { name: 'Tracee Ellis Ross',       instagram: '@traceeellisross',    birthday: '1972-10-29', picture: 'https://randomuser.me/api/portraits/women/58.jpg', notes: 'Pattern nails — loves vibrant fashion-forward and artistic designs' },
  { name: 'Hailee Steinfeld',        instagram: '@haileesteinfeld',    birthday: '1996-12-11', picture: 'https://randomuser.me/api/portraits/women/59.jpg', notes: 'Starving for nail art — loves pop-star chic and trendy designs' },
  { name: 'Shay Mitchell',           instagram: '@shaymitchell',       birthday: '1987-04-10', picture: 'https://randomuser.me/api/portraits/women/60.jpg', notes: 'PLL nails — loves glam and mysterious, always brings inspo photos' },
  { name: 'Ashley Benson',           instagram: '@ashleybenson',       birthday: '1989-12-18', picture: 'https://randomuser.me/api/portraits/women/61.jpg', notes: 'Hanna Marin nails — loves edgy cool-girl and playful fashion nails' },
  { name: 'Lucy Hale',               instagram: '@lucyhale',           birthday: '1989-06-14', picture: 'https://randomuser.me/api/portraits/women/62.jpg', notes: 'PLL Aria nails — loves edgy and eclectic mixed with soft feminine' },
  { name: 'Troian Bellisario',       instagram: '@sleepinthegardn',    birthday: '1985-10-28', picture: 'https://randomuser.me/api/portraits/women/63.jpg', notes: 'Spencer Hastings nails — loves smart and sophisticated minimal art' },
  { name: 'Raven-Symoné',            instagram: '@ravensymone',        birthday: '1985-12-10', picture: 'https://randomuser.me/api/portraits/women/64.jpg', notes: 'That\'s So Raven nails — loves psychic-inspired fun and bold designs' },
  { name: 'Brenda Song',             instagram: '@brendasong',         birthday: '1988-03-27', picture: 'https://randomuser.me/api/portraits/women/65.jpg', notes: 'London Tipton nails — loves luxe and pampered, always gets the works' },
  { name: 'Sarah Michelle Gellar',   instagram: '@sarahmgellar',       birthday: '1977-04-14', picture: 'https://randomuser.me/api/portraits/women/66.jpg', notes: 'Buffy nails — vampire slayer strength, loves dark and powerful art' },
  { name: 'Jennifer Love Hewitt',    instagram: '@jenniferlovehewitt', birthday: '1979-02-21', picture: 'https://randomuser.me/api/portraits/women/67.jpg', notes: 'I Know What You Did nails — loves romantic and sweet feminine art' },
  { name: 'Michelle Pfeiffer',       instagram: '@michellefpfeiffer',  birthday: '1958-04-29', picture: 'https://randomuser.me/api/portraits/women/68.jpg', notes: 'Catwoman nails — sleek black tips and fierce dramatic nail looks' },
  { name: 'Goldie Hawn',             instagram: '@goldiehawn',         birthday: '1945-11-21', picture: 'https://randomuser.me/api/portraits/women/69.jpg', notes: 'Overboard nails — bubbly and fun, loves pastel and playful designs' },
  { name: 'Bette Midler',            instagram: '@bettemidler',        birthday: '1945-12-01', picture: 'https://randomuser.me/api/portraits/women/70.jpg', notes: 'Wind Beneath My Nails — grand and theatrical, always a showstopper' },
  { name: 'Barbra Streisand',        instagram: '@barbrastreisand',    birthday: '1942-04-24', picture: 'https://randomuser.me/api/portraits/women/71.jpg', notes: 'Funny Nails — classic Broadway glam, loves bold statement looks' },
  { name: 'Florence Welch',          instagram: '@florenceandmachine', birthday: '1986-08-28', picture: 'https://randomuser.me/api/portraits/women/72.jpg', notes: 'Dog Days nails — ethereal and wild, loves dramatic dark romanticism' },
  { name: 'Lykke Li',                instagram: '@lykkeli',            birthday: '1986-03-18', picture: 'https://randomuser.me/api/portraits/women/73.jpg', notes: 'I Follow Rivers nails — Scandi cool and minimalist with edge' },
  { name: 'Robyn Carlsson',          instagram: '@robynkonichiwa',     birthday: '1979-06-12', picture: 'https://randomuser.me/api/portraits/women/74.jpg', notes: 'Dancing on My Own nails — loves disco-inspired chrome and bold art' },
  { name: 'Tove Lo',                 instagram: '@tovelo',             birthday: '1987-10-29', picture: 'https://randomuser.me/api/portraits/women/75.jpg', notes: 'Habits nails — dark and indie-pop, loves moody and edgy nail looks' },
  { name: 'Zara Larsson',            instagram: '@zaralarsson',        birthday: '1997-12-16', picture: 'https://randomuser.me/api/portraits/women/76.jpg', notes: 'Lush Life nails — loves vibrant pop-forward and bold colorful sets' },
  { name: 'Sigrid Raabe',            instagram: '@sigrid',             birthday: '1996-09-05', picture: 'https://randomuser.me/api/portraits/women/77.jpg', notes: 'Stranger nails — loves quirky Scandinavian-inspired unique designs' },
  { name: 'Arlo Parks',              instagram: '@arloparks',          birthday: '2000-02-19', picture: 'https://randomuser.me/api/portraits/women/78.jpg', notes: 'Collapsed in Sunbeams nails — loves warm indie and dreamy nail art' },
  { name: 'Celeste',                 instagram: '@celesteofficial',    birthday: '1994-10-05', picture: 'https://randomuser.me/api/portraits/women/79.jpg', notes: 'Stop This Flame nails — loves jazz-inspired vintage and classic art' },
  { name: 'Little Simz',            instagram: '@littlesimz',          birthday: '1994-08-29', picture: 'https://randomuser.me/api/portraits/women/80.jpg', notes: 'Stillwater nails — loves raw and authentic urban-inspired nail art' },
  { name: 'M.I.A.',                  instagram: '@mia',                birthday: '1975-07-18', picture: 'https://randomuser.me/api/portraits/women/81.jpg', notes: 'Paper Planes nails — loves loud graphic patterns and bold colors' },
  { name: 'Santigold',               instagram: '@santigold',          birthday: '1976-07-25', picture: 'https://randomuser.me/api/portraits/women/82.jpg', notes: 'Creator nails — loves eclectic and genre-defying artistic designs' },
  { name: 'Clairo',                  instagram: '@clairo',             birthday: '1998-08-18', picture: 'https://randomuser.me/api/portraits/women/83.jpg', notes: 'Sofia nails — bedroom pop aesthetic, loves soft and cozy indie art' },
  { name: 'Beabadoobee',             instagram: '@beabadoobee',        birthday: '2000-06-03', picture: 'https://randomuser.me/api/portraits/women/84.jpg', notes: 'Death Bed nails — sad girl indie, loves soft romantic floral art' },
  { name: 'Girl in Red',             instagram: '@girlinred',          birthday: '1999-05-22', picture: 'https://randomuser.me/api/portraits/women/85.jpg', notes: 'We Fell in Love in October nails — loves quiet indie romantica' },
  { name: 'Soccer Mommy',            instagram: '@soccermommyband',    birthday: '1997-05-28', picture: 'https://randomuser.me/api/portraits/women/86.jpg', notes: 'Clean nails — indie soft girl aesthetic, loves pale and subtle art' },
  { name: 'Snail Mail',              instagram: '@snailmailband',      birthday: '1999-06-16', picture: 'https://randomuser.me/api/portraits/women/87.jpg', notes: 'Valentine nails — deeply emotional and artistic indie nail looks' },
  { name: 'Julien Baker',            instagram: '@julienbaker',        birthday: '1995-09-29', picture: 'https://randomuser.me/api/portraits/women/88.jpg', notes: 'Sprained Ankle nails — raw and beautiful, loves minimal dark tones' },
  { name: 'Lucy Dacus',              instagram: '@lucydacus',          birthday: '1995-06-02', picture: 'https://randomuser.me/api/portraits/women/89.jpg', notes: 'Home Video nails — nostalgic and poetic, loves vintage-inspired art' },
  { name: 'Angel Olsen',             instagram: '@angelmolsen',        birthday: '1987-01-22', picture: 'https://randomuser.me/api/portraits/women/90.jpg', notes: 'All Mirrors nails — loves surreal and reflective ethereal nail art' },
  { name: 'Sharon Van Etten',        instagram: '@sharonvanetten',     birthday: '1981-02-26', picture: 'https://randomuser.me/api/portraits/women/91.jpg', notes: 'Remind Me Tomorrow nails — loves raw indie and emotional designs' },
  { name: 'Cat Power',               instagram: '@catpowermusic',      birthday: '1972-01-21', picture: 'https://randomuser.me/api/portraits/women/92.jpg', notes: 'The Greatest nails — minimalist and deeply intentional nail looks' },
  { name: 'Feist',                   instagram: '@feist',              birthday: '1976-02-13', picture: 'https://randomuser.me/api/portraits/women/93.jpg', notes: '1234 nails — playful and whimsical folk-pop inspired nail art' },
  { name: 'Waxahatchee',             instagram: '@waxahatchee_music',  birthday: '1990-01-12', picture: 'https://randomuser.me/api/portraits/women/94.jpg', notes: 'Out in the Storm nails — loves Americana and earthy indie nail art' },
  { name: 'Phoebe Bridgers',         instagram: '@phoebebridgers',     birthday: '1994-08-17', picture: 'https://randomuser.me/api/portraits/women/95.jpg', notes: 'Punisher nails — skeleton emoji energy, loves black and moon designs' },
  { name: 'Maggie Rogers',           instagram: '@maggierogers',       birthday: '1994-04-25', picture: 'https://randomuser.me/api/portraits/women/96.jpg', notes: 'Alaska nails — nature-inspired and forest-toned, loves earthy art' },
  { name: 'Gracie Abrams',           instagram: '@gracieabrams',       birthday: '1999-09-07', picture: 'https://randomuser.me/api/portraits/women/97.jpg', notes: 'This Is What It Feels Like nails — soft indie and emotional designs' },
  { name: 'Caroline Polachek',       instagram: '@carolinepolachek',   birthday: '1985-08-08', picture: 'https://randomuser.me/api/portraits/women/98.jpg', notes: 'Pang nails — art-pop surrealism, loves unconventional artistic looks' },
  { name: 'Ethel Cain',              instagram: '@ethel_cain',         birthday: '1998-06-26', picture: 'https://randomuser.me/api/portraits/women/99.jpg', notes: 'Preacher\'s Daughter nails — gothic Southern, loves dark ethereal art' },
];

const CELEBRITIES_5 = [
  { name: 'Huda Kattan',             instagram: '@hudabeauty',         birthday: '1983-10-02', picture: 'https://randomuser.me/api/portraits/women/0.jpg',  notes: 'Beauty mogul — literally invented nail trends, always a VIP treat' },
  { name: 'Jackie Aina',             instagram: '@jackieaina',         birthday: '1991-08-04', picture: 'https://randomuser.me/api/portraits/women/1.jpg',  notes: 'Blend and nail queen — loves deeply pigmented jewel-toned sets' },
  { name: 'Nikkie de Jager',         instagram: '@nikkietutorials',    birthday: '1994-03-02', picture: 'https://randomuser.me/api/portraits/women/2.jpg',  notes: 'NikkieTutorials nails — loves dramatic transformational nail art' },
  { name: 'Pokimane',                instagram: '@imane',              birthday: '1996-05-14', picture: 'https://randomuser.me/api/portraits/women/3.jpg',  notes: 'Twitch queen nails — cute and trendy, loves pastel gaming-inspired' },
  { name: 'Valkyrae',                instagram: '@valkyrae',           birthday: '1992-01-08', picture: 'https://randomuser.me/api/portraits/women/4.jpg',  notes: 'Co-Owner of 100 Thieves nails — loves dark and bold gamer aesthetic' },
  { name: 'LilyPichu',               instagram: '@lilypichu',          birthday: '1994-10-20', picture: 'https://randomuser.me/api/portraits/women/5.jpg',  notes: 'Piano and nails queen — loves kawaii pastel and cute anime art' },
  { name: 'Lele Pons',               instagram: '@lelepons',           birthday: '1996-06-25', picture: 'https://randomuser.me/api/portraits/women/6.jpg',  notes: 'Viral queen nails — loves fun and energetic content-ready designs' },
  { name: 'Nara Smith',              instagram: '@naraaziza',          birthday: '2002-01-22', picture: 'https://randomuser.me/api/portraits/women/7.jpg',  notes: 'Trad wife nails — cottage-core aesthetic, loves soft florals always' },
  { name: 'Tinx',                    instagram: '@tinx',               birthday: '1991-06-18', picture: 'https://randomuser.me/api/portraits/women/8.jpg',  notes: 'Rich mom nails — loves quiet luxury and glazed donut aesthetic' },
  { name: 'Olivia Palermo',          instagram: '@oliviapalermo',      birthday: '1986-02-28', picture: 'https://randomuser.me/api/portraits/women/9.jpg',  notes: 'The City nails — impeccably styled, loves ultra-polished classic looks' },
  { name: 'Nicky Hilton',            instagram: '@nickyhilton',        birthday: '1983-10-05', picture: 'https://randomuser.me/api/portraits/women/10.jpg', notes: 'Hilton heiress nails — classic and chic, loves clean French tips' },
  { name: 'Nicole Richie',           instagram: '@nicolerichie',       birthday: '1981-09-21', picture: 'https://randomuser.me/api/portraits/women/11.jpg', notes: 'The Simple Life nails — loves boho-chic and eclectic cool-girl art' },
  { name: 'Lauren Conrad',           instagram: '@laurenconrad',       birthday: '1986-02-01', picture: 'https://randomuser.me/api/portraits/women/12.jpg', notes: 'LC nails — loves clean Laguna Beach aesthetic and soft California art' },
  { name: 'Kristin Cavallari',       instagram: '@kristincavallari',   birthday: '1987-01-05', picture: 'https://randomuser.me/api/portraits/women/13.jpg', notes: 'Very Cavallari nails — loves edgy and bold with a polished finish' },
  { name: 'Audrina Patridge',        instagram: '@audrinapatridge',    birthday: '1985-05-09', picture: 'https://randomuser.me/api/portraits/women/14.jpg', notes: 'Hills nails — boho and carefree, loves beach-inspired nail designs' },
  { name: 'Whitney Port',            instagram: '@whitneyeveport',     birthday: '1985-03-04', picture: 'https://randomuser.me/api/portraits/women/15.jpg', notes: 'The City fashion nails — loves chic New York-inspired classic looks' },
  { name: 'Hilary Duff',             instagram: '@hilaryduff',         birthday: '1987-09-28', picture: 'https://randomuser.me/api/portraits/women/16.jpg', notes: 'Younger nails — loves modern and trendy mom-chic nail designs' },
  { name: 'Debby Ryan',              instagram: '@debbyryan',          birthday: '1993-05-13', picture: 'https://randomuser.me/api/portraits/women/17.jpg', notes: 'Insatiable nails — loves vibrant and unexpected bold nail designs' },
  { name: 'Bridgit Mendler',         instagram: '@bridgitmendler',     birthday: '1992-12-18', picture: 'https://randomuser.me/api/portraits/women/18.jpg', notes: 'Goodbye to You nails — loves soft and sweet feminine nail art' },
  { name: 'Peyton List',             instagram: '@peytonlist',         birthday: '1998-04-06', picture: 'https://randomuser.me/api/portraits/women/19.jpg', notes: 'Cobra Kai nails — loves fierce sporty-chic and strong nail designs' },
  { name: 'Sofia Carson',            instagram: '@sofiacarson',        birthday: '1993-04-26', picture: 'https://randomuser.me/api/portraits/women/20.jpg', notes: 'Descendants nails — princess meets rebel, loves dramatic nail art' },
  { name: 'China Anne McClain',      instagram: '@chinaannemcclain',   birthday: '1998-08-25', picture: 'https://randomuser.me/api/portraits/women/21.jpg', notes: 'A.N.T. Farm nails — talented and vibrant, loves colorful art' },
  { name: 'Alyssa Milano',           instagram: '@milano_alyssa',      birthday: '1972-12-19', picture: 'https://randomuser.me/api/portraits/women/22.jpg', notes: 'Charmed nails — loves magical and witchy-inspired dark nail designs' },
  { name: 'Tia Mowry',               instagram: '@tiamowry',           birthday: '1978-07-06', picture: 'https://randomuser.me/api/portraits/women/23.jpg', notes: 'Sister Sister nails — warm and maternal, loves soft and classic art' },
  { name: 'Tamera Mowry',            instagram: '@tameraowry',         birthday: '1978-07-06', picture: 'https://randomuser.me/api/portraits/women/24.jpg', notes: 'Twin nails that match sister\'s — loves warm natural tones always' },
  { name: 'Lisa Bonet',              instagram: '@lisabonetnews',      birthday: '1967-11-16', picture: 'https://randomuser.me/api/portraits/women/25.jpg', notes: 'Cosby Show boho queen — loves bohemian and eclectic ethereal art' },
  { name: 'Willow Smith',            instagram: '@willowsmith',        birthday: '2000-10-31', picture: 'https://randomuser.me/api/portraits/women/26.jpg', notes: 'Whip My Nails — alt-rock meets ethereal, loves dark artistic designs' },
  { name: 'Jada Pinkett Smith',      instagram: '@jadapinkettsmith',   birthday: '1971-09-18', picture: 'https://randomuser.me/api/portraits/women/27.jpg', notes: 'Red Table Nails — loves bold and intentional designs, very mindful' },
  { name: 'Kylie Minogue',           instagram: '@kylieminogue',       birthday: '1968-05-28', picture: 'https://randomuser.me/api/portraits/women/28.jpg', notes: 'Can\'t Get Nails Out of My Head — loves pop queen glam and sparkle' },
  { name: 'Sophie Ellis-Bextor',     instagram: '@sophieellisbextor',  birthday: '1979-04-10', picture: 'https://randomuser.me/api/portraits/women/29.jpg', notes: 'Murder on the Nailfloor — loves disco glamour and retro art' },
  { name: 'Paloma Faith',            instagram: '@palomafaith',        birthday: '1981-07-21', picture: 'https://randomuser.me/api/portraits/women/30.jpg', notes: 'Only Love Can Hurt This Much — loves dramatic vintage nail art' },
  { name: 'Mabel McVey',             instagram: '@mabel',              birthday: '1996-02-19', picture: 'https://randomuser.me/api/portraits/women/31.jpg', notes: 'Don\'t Call Me Up nails — loves R&B-inspired cool and modern art' },
  { name: 'Dua Saleh',               instagram: '@dua_saleh',          birthday: '1994-07-12', picture: 'https://randomuser.me/api/portraits/women/32.jpg', notes: 'Sudan Archives nails — experimental and artistic with bold identity' },
  { name: 'Sudan Archives',          instagram: '@sudanarchives',      birthday: '1996-10-14', picture: 'https://randomuser.me/api/portraits/women/33.jpg', notes: 'Athena nails — powerful and experimental avant-garde nail designs' },
  { name: 'Victoria Monét',          instagram: '@victoriamone',       birthday: '1993-12-01', picture: 'https://randomuser.me/api/portraits/women/34.jpg', notes: 'Jaguar II nails — Grammy era glam, loves sultry and fierce designs' },
  { name: 'Coco Jones',              instagram: '@cocojones',          birthday: '1998-01-04', picture: 'https://randomuser.me/api/portraits/women/35.jpg', notes: 'ICU nails — rising R&B star, loves chic medium coffin and gold art' },
  { name: 'Tyla',                    instagram: '@tyla',               birthday: '2002-01-30', picture: 'https://randomuser.me/api/portraits/women/36.jpg', notes: 'Water nails — South African pop star, loves fluid and tropical art' },
  { name: 'Ayra Starr',              instagram: '@ayrastarr',          birthday: '2002-06-14', picture: 'https://randomuser.me/api/portraits/women/37.jpg', notes: 'Bloody Samaritan nails — Afrobeats queen, loves vibrant bold designs' },
  { name: 'Amaarae',                 instagram: '@amaarae',            birthday: '1994-10-11', picture: 'https://randomuser.me/api/portraits/women/38.jpg', notes: 'SAD GIRLZ LUV MONEY nails — ethereal and otherworldly always' },
  { name: 'Rema',                    instagram: '@heisrema',           birthday: '2000-05-01', picture: 'https://randomuser.me/api/portraits/women/39.jpg', notes: 'Calm Down nails — Afrobeats energy, loves cool and vibrant designs' },
  { name: 'Tiwa Savage',             instagram: '@tiwasavage',         birthday: '1980-02-05', picture: 'https://randomuser.me/api/portraits/women/40.jpg', notes: 'African Queen nails — Afrobeats royalty, loves bold and regal designs' },
  { name: 'Yemi Alade',              instagram: '@yemialade',          birthday: '1989-03-13', picture: 'https://randomuser.me/api/portraits/women/41.jpg', notes: 'Johnny nails — Africa pop queen, loves vibrant and colorful designs' },
  { name: 'Asa Akira',               instagram: '@asaakira',           birthday: '1986-01-03', picture: 'https://randomuser.me/api/portraits/women/42.jpg', notes: 'Concrete Garden nails — loves raw and authentic dark artistic designs' },
  { name: 'Priyanka Chopra Jonas',   instagram: '@priyankachopra',     birthday: '1982-07-18', picture: 'https://randomuser.me/api/portraits/women/43.jpg', notes: 'Quantico nails — Bollywood meets Hollywood, loves glamorous art' },
  { name: 'Deepika Padukone',        instagram: '@deepikapadukone',    birthday: '1986-01-05', picture: 'https://randomuser.me/api/portraits/women/44.jpg', notes: 'Pathaan nails — Bollywood royalty, loves rich traditional gem tones' },
  { name: 'Sonam Kapoor',            instagram: '@sonamkapoor',        birthday: '1985-06-09', picture: 'https://randomuser.me/api/portraits/women/45.jpg', notes: 'Fashion nails — Bollywood style icon, loves high couture nail art' },
  { name: 'Alia Bhatt',              instagram: '@aliaabhatt',         birthday: '1993-03-15', picture: 'https://randomuser.me/api/portraits/women/46.jpg', notes: 'Gangubai nails — fierce and powerful, loves bold Bollywood designs' },
  { name: 'Katrina Kaif',            instagram: '@katrinakaif',        birthday: '1983-07-16', picture: 'https://randomuser.me/api/portraits/women/47.jpg', notes: 'Tiger nails — loves clean and stunning modern minimalist designs' },
  { name: 'Lisa Manoban',            instagram: '@lalalisa_m',         birthday: '1997-03-27', picture: 'https://randomuser.me/api/portraits/women/48.jpg', notes: 'LALISA nails — K-pop icon, loves fierce and editorial designs' },
  { name: 'Jennie Kim',              instagram: '@jennierubyjane',     birthday: '1996-01-16', picture: 'https://randomuser.me/api/portraits/women/49.jpg', notes: 'Solo nails — BLACKPINK queen, loves chic and luxe nail looks' },
  { name: 'Rosé Park',               instagram: '@roses_are_rosie',    birthday: '1997-02-11', picture: 'https://randomuser.me/api/portraits/women/50.jpg', notes: 'On the Ground nails — loves elegant and romantic feminine designs' },
  { name: 'Jisoo Kim',               instagram: '@sooyaaa__',          birthday: '1995-01-03', picture: 'https://randomuser.me/api/portraits/women/51.jpg', notes: 'Flower nails — K-beauty queen, loves soft and delicate Korean art' },
  { name: 'Hwasa',                   instagram: '@mariahwasa',         birthday: '1995-07-23', picture: 'https://randomuser.me/api/portraits/women/52.jpg', notes: 'Maria nails — fierce MAMAMOO energy, loves bold and provocative art' },
  { name: 'CL',                      instagram: '@chaelincl',          birthday: '1991-02-26', picture: 'https://randomuser.me/api/portraits/women/53.jpg', notes: 'Baddest Female nails — loves fierce and powerful K-pop nail art' },
  { name: 'Sunmi',                   instagram: '@miyayeah',           birthday: '1992-05-02', picture: 'https://randomuser.me/api/portraits/women/54.jpg', notes: 'Gashina nails — loves artistic and avant-garde K-pop nail designs' },
  { name: 'Hyuna',                   instagram: '@hyunah_aa',          birthday: '1992-06-06', picture: 'https://randomuser.me/api/portraits/women/55.jpg', notes: 'Bubble Pop nails — loves edgy and provocative Korean nail art' },
  { name: 'IU',                      instagram: '@dlwlrma',            birthday: '1993-05-16', picture: 'https://randomuser.me/api/portraits/women/56.jpg', notes: 'Eight nails — nation\'s little sister, loves cute and sweet designs' },
  { name: 'Taeyeon',                 instagram: '@taeyeon_ss',         birthday: '1989-03-09', picture: 'https://randomuser.me/api/portraits/women/57.jpg', notes: 'INVU nails — SNSD leader, loves pure and elegant nail designs' },
  { name: 'Seulgi',                  instagram: '@hi_sseulgi',         birthday: '1994-02-10', picture: 'https://randomuser.me/api/portraits/women/58.jpg', notes: '28 Reasons nails — Red Velvet bear, loves cute and chic Korean art' },
  { name: 'Winter',                  instagram: '@aespa_official',     birthday: '2001-01-01', picture: 'https://randomuser.me/api/portraits/women/59.jpg', notes: 'aespa Karina nails — loves futuristic and alien-inspired nail art' },
  { name: 'aespa Karina',            instagram: '@aespa_karina',       birthday: '2000-04-11', picture: 'https://randomuser.me/api/portraits/women/60.jpg', notes: 'MY, the first album nails — loves sleek futuristic K-pop nail looks' },
  { name: 'Wonyoung Jang',           instagram: '@for_everyoung10',    birthday: '2004-08-31', picture: 'https://randomuser.me/api/portraits/women/61.jpg', notes: 'IVE queen nails — princess energy, loves crystal and pearl designs' },
  { name: 'Le Sserafim Kazuha',      instagram: '@kazuha._.le',        birthday: '2003-08-09', picture: 'https://randomuser.me/api/portraits/women/62.jpg', notes: 'Fearless nails — ballerina meets K-pop, loves elegant and precise art' },
  { name: 'NewJeans Minji',          instagram: '@newjeans_official',  birthday: '2004-05-07', picture: 'https://randomuser.me/api/portraits/women/63.jpg', notes: 'Hype Boy nails — denim aesthetic, loves Y2K-inspired fresh designs' },
  { name: 'Stray Kids Hyunjin',      instagram: '@hyunjinography',     birthday: '2000-03-20', picture: 'https://randomuser.me/api/portraits/women/64.jpg', notes: 'Miroh nails — artistic and painting-inspired avant-garde designs' },
  { name: 'Lainey Wilson',           instagram: '@laineywilson',       birthday: '1992-05-19', picture: 'https://randomuser.me/api/portraits/women/65.jpg', notes: 'Bell Bottom Country nails — loves retro-inspired Western art designs' },
  { name: 'Ashley McBryde',          instagram: '@ashleymcbryde',      birthday: '1983-07-27', picture: 'https://randomuser.me/api/portraits/women/66.jpg', notes: 'A Little Dive Bar nails — authentic and raw country nail designs' },
  { name: 'Carly Pearce',            instagram: '@carlypearce',        birthday: '1990-03-24', picture: 'https://randomuser.me/api/portraits/women/67.jpg', notes: 'Every Little Thing nails — sweet country girl loves soft classic art' },
  { name: 'Gabby Barrett',           instagram: '@gabbybarrett_',      birthday: '2000-03-05', picture: 'https://randomuser.me/api/portraits/women/68.jpg', notes: 'I Hope nails — rising country star loves sweet and romantic designs' },
  { name: 'Kacey Musgraves',         instagram: '@spaceykacey',        birthday: '1988-08-21', picture: 'https://randomuser.me/api/portraits/women/69.jpg', notes: 'Star-Crossed nails — cosmic cowgirl, loves rainbow and star designs' },
  { name: 'Ingrid Andress',          instagram: '@ingridandress',      birthday: '1991-05-21', picture: 'https://randomuser.me/api/portraits/women/70.jpg', notes: 'More Hearts Than Mine nails — loves heartfelt and delicate designs' },
  { name: 'Mimi Webb',               instagram: '@mimimebb',           birthday: '2001-02-24', picture: 'https://randomuser.me/api/portraits/women/71.jpg', notes: 'Good Without nails — UK pop rising star, loves bold emotional looks' },
  { name: 'Aitch',                   instagram: '@aitchofficial',      birthday: '1999-12-09', picture: 'https://randomuser.me/api/portraits/women/72.jpg', notes: 'Straight Rhymez nails — Manchester energy, loves street-inspired art' },
  { name: 'Griff',                   instagram: '@griffofficial',      birthday: '2000-09-26', picture: 'https://randomuser.me/api/portraits/women/73.jpg', notes: 'Black Hole nails — indie pop, loves cosmic and celestial nail art' },
  { name: 'Holly Humberstone',       instagram: '@hollyhumberstone',   birthday: '2001-02-18', picture: 'https://randomuser.me/api/portraits/women/74.jpg', notes: 'Falling Asleep nails — dark indie pop, loves moody dream-like art' },
  { name: 'Nina Chuba',              instagram: '@ninachuba',          birthday: '1999-01-02', picture: 'https://randomuser.me/api/portraits/women/75.jpg', notes: 'Wildberry Lillet nails — German pop, loves bold and playful designs' },
  { name: 'Saucy Santana',           instagram: '@saucysantana',       birthday: '1997-07-25', picture: 'https://randomuser.me/api/portraits/women/76.jpg', notes: 'Material Girl nails — material girl energy, loves all things extra' },
  { name: 'GloRilla',                instagram: '@glorillapimp',       birthday: '1999-07-28', picture: 'https://randomuser.me/api/portraits/women/77.jpg', notes: 'F.N.F. nails — Memphis energy, loves long bold and fierce designs' },
  { name: 'Sexyy Red',               instagram: '@sexyyred',           birthday: '2001-04-15', picture: 'https://randomuser.me/api/portraits/women/78.jpg', notes: 'SkeeYee nails — St. Louis energy, loves wild and fun nail designs' },
  { name: 'Ice Spice',               instagram: '@icespice',           birthday: '2000-01-01', picture: 'https://randomuser.me/api/portraits/women/79.jpg', notes: 'Munch nails — Bronx princess, loves extra-long and fierce nail art' },
  { name: 'Latto',                   instagram: '@latto777',           birthday: '2001-12-22', picture: 'https://randomuser.me/api/portraits/women/80.jpg', notes: 'Big Energy nails — Atlanta queen, loves extra-long and blingy art' },
  { name: 'Kash Doll',               instagram: '@kashdoll',           birthday: '1992-03-14', picture: 'https://randomuser.me/api/portraits/women/81.jpg', notes: 'For Everybody nails — Detroit queen, loves flashy and bold nail art' },
  { name: 'Cuban Doll',              instagram: '@cubandoll',          birthday: '1997-01-11', picture: 'https://randomuser.me/api/portraits/women/82.jpg', notes: 'Bankrupt nails — Texas energy, loves exotic and vibrant nail looks' },
  { name: 'Asian Doll',              instagram: '@asiandoll',          birthday: '1996-09-07', picture: 'https://randomuser.me/api/portraits/women/83.jpg', notes: 'Let It Fly nails — Dallas queen, loves fierce and bold designs' },
  { name: 'Lakeyah',                 instagram: '@lakeyah',            birthday: '2000-11-07', picture: 'https://randomuser.me/api/portraits/women/84.jpg', notes: 'Female Goat nails — Milwaukee queen, loves powerful fierce nail art' },
  { name: 'Monaleo',                 instagram: '@monaleo',            birthday: '2001-10-03', picture: 'https://randomuser.me/api/portraits/women/85.jpg', notes: 'Beating Down Yo Block nails — Houston queen, loves bold extra looks' },
  { name: 'BIA',                     instagram: '@bia',                birthday: '1992-05-18', picture: 'https://randomuser.me/api/portraits/women/86.jpg', notes: 'WHOLE LOTTA MONEY nails — loves luxe and flashy nail designs' },
  { name: 'Erica Banks',             instagram: '@ericabanks',         birthday: '1997-12-01', picture: 'https://randomuser.me/api/portraits/women/87.jpg', notes: 'Buss It nails — loves fierce and viral-worthy nail designs' },
  { name: 'Flo Milli',               instagram: '@flomilliee',         birthday: '2000-01-09', picture: 'https://randomuser.me/api/portraits/women/88.jpg', notes: 'Conceited nails — spunky and fearless, loves hot pink and electric' },
  { name: 'Coi Leray',               instagram: '@coileray',           birthday: '1997-05-02', picture: 'https://randomuser.me/api/portraits/women/89.jpg', notes: 'No More Parties nails — loves trendy and fashionable nail designs' },
  { name: 'JT (City Girls)',         instagram: '@thegirlljt',         birthday: '1992-12-06', picture: 'https://randomuser.me/api/portraits/women/90.jpg', notes: 'Act Up nails — extra long press-ons, loves show-stopping designs' },
  { name: 'Dreezy',                  instagram: '@dreezy',             birthday: '1994-06-28', picture: 'https://randomuser.me/api/portraits/women/91.jpg', notes: 'No Hard Feelings nails — Chicago queen, loves bold and clean art' },
  { name: 'Kodie Shane',             instagram: '@kodieshane',         birthday: '1999-10-08', picture: 'https://randomuser.me/api/portraits/women/92.jpg', notes: 'Sad songs nails — loves dark emotional and artistic nail designs' },
  { name: 'Mulatto',                 instagram: '@latto777',           birthday: '2001-12-22', picture: 'https://randomuser.me/api/portraits/women/93.jpg', notes: 'Queen of Da Souf nails — Atlanta power, loves extra and bold looks' },
  { name: 'Kaash Paige',             instagram: '@kaashpaige',         birthday: '2000-07-29', picture: 'https://randomuser.me/api/portraits/women/94.jpg', notes: 'Love Songs nails — loves romantic and emotional nail art designs' },
  { name: 'Ambré',                   instagram: '@ambreee_official',   birthday: '1996-01-26', picture: 'https://randomuser.me/api/portraits/women/95.jpg', notes: 'All I Need nails — R&B gem, loves warm and sultry gel nail designs' },
  { name: 'Mereba',                  instagram: '@mereba',             birthday: '1990-06-21', picture: 'https://randomuser.me/api/portraits/women/96.jpg', notes: 'Sandstorm nails — loves earthy Afro-soul and spiritual nail art' },
  { name: 'Moonchild Sanelly',       instagram: '@moonchildsanelly',   birthday: '1986-09-30', picture: 'https://randomuser.me/api/portraits/women/97.jpg', notes: 'Bashiri nails — South African queen, loves neon and avant-garde art' },
  { name: 'Sho Madjozi',             instagram: '@shomadjozi',         birthday: '1992-05-15', picture: 'https://randomuser.me/api/portraits/women/98.jpg', notes: 'John Cena nails — Tsonga pride, loves vibrant colorful African art' },
  { name: 'Msaki',                   instagram: '@msaki_sa',           birthday: '1988-07-04', picture: 'https://randomuser.me/api/portraits/women/99.jpg', notes: 'Ikhaya nails — South African soul, loves earthy and soulful designs' },
];

// ── Generate 500 regular clients ────────────────────────
function generateClients() {
  const clients = [];
  const seen = new Set();
  let idx = 0;
  while (clients.length < 500) {
    const fi = idx % FIRST_NAMES.length;
    const li = Math.floor(idx / FIRST_NAMES.length) % LAST_NAMES.length;
    const first = FIRST_NAMES[fi];
    const last  = LAST_NAMES[li];
    const name  = `${first} ${last}`;
    if (!seen.has(name)) {
      seen.add(name);
      const i   = clients.length;
      const phone = `(614) 555-${String(1001 + i).padStart(4, '0')}`;
      const email = `${first.toLowerCase()}.${last.toLowerCase()}${i > 0 ? i : ''}@email.com`;
      const addr  = `${COLUMBUS_STREETS[i % COLUMBUS_STREETS.length]}, ${COLUMBUS_CITIES[i % COLUMBUS_CITIES.length]}`;
      const byear = 1975 + (i * 37 % 28);
      const bmon  = String(1 + (i * 13 % 12)).padStart(2, '0');
      const bday  = String(1 + (i * 7 % 28)).padStart(2, '0');
      // ~60% of clients have a favorite tech they always request.
      const favoriteTech = Math.random() < 0.6
        ? TECH_NAMES[Math.floor(Math.random() * TECH_NAMES.length)]
        : '';
      clients.push({
        name,
        phone,
        email,
        address: Math.random() > 0.15 ? addr : '',
        birthday: Math.random() > 0.3 ? `${byear}-${bmon}-${bday}` : '',
        notes: CLIENT_NOTES[i % CLIENT_NOTES.length],
        picture: '',
        instagram: Math.random() > 0.5 ? `@${first.toLowerCase()}${last.toLowerCase().slice(0,4)}` : '',
        venmo: Math.random() > 0.4 ? `${first.toLowerCase()}${last.toLowerCase().slice(0,5)}` : '',
        facebook: '',
        tiktok: '',
        instagramTags: [],
        googleReviews: [],
        visits: [],
        favoriteTech,
        _demo: true,
      });
    }
    idx++;
  }
  return clients;
}

// ── Generate 500 celebrity clients ──────────────────────
function generateCelebrities() {
  return [...CELEBRITIES, ...CELEBRITIES_2, ...CELEBRITIES_3, ...CELEBRITIES_4, ...CELEBRITIES_5].map((celeb, i) => ({
    name:       celeb.name,
    phone:      `(614) 555-${String(5001 + i).padStart(4, '0')}`,
    email:      `${celeb.name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')}@vip.com`,
    address:    '',
    birthday:   celeb.birthday || '',
    notes:      celeb.notes || '',
    picture:    celeb.picture || '',
    instagram:  celeb.instagram || '',
    facebook:   '',
    tiktok:     celeb.tiktok || '',
    venmo:      '',
    instagramTags: [],
    googleReviews: [],
    visits: [],
    // Celebrities are VIPs — 90% always book the same tech.
    favoriteTech: Math.random() < 0.9 ? TECH_NAMES[i % TECH_NAMES.length] : '',
    _demo: true,
    _celebrity: true,
  }));
}

// ── Service templates ───────────────────────────────────
const SERVICES = [
  { name: 'Gel-X',                     duration: 75,  price: 75,  weight: 12 },
  { name: 'Structured Gel Manicure',   duration: 65,  price: 55,  weight: 10 },
  { name: 'Gel Manicure',              duration: 40,  price: 45,  weight: 18 },
  { name: 'Signature Manicure',        duration: 40,  price: 35,  weight: 8  },
  { name: 'Deluxe Manicure',           duration: 45,  price: 45,  weight: 6  },
  { name: 'Spa Manicure',              duration: 30,  price: 25,  weight: 10 },
  { name: 'Gel Polish Change',         duration: 30,  price: 32,  weight: 14 },
  { name: 'Spa Pedicure',              duration: 40,  price: 45,  weight: 16 },
  { name: 'Signature Pedicure',        duration: 50,  price: 55,  weight: 10 },
  { name: 'Deluxe Pedicure',           duration: 65,  price: 70,  weight: 6  },
  { name: 'Toe Polish Change',         duration: 20,  price: 20,  weight: 8  },
  { name: 'Nail Art',                  duration: 20,  price: 20,  weight: 7  },
  { name: 'Removal',                   duration: 20,  price: 12,  weight: 9  },
  { name: 'Dip',                       duration: 15,  price: 18,  weight: 6  },
  { name: 'Luxury Paraffin Treatment', duration: 15,  price: 15,  weight: 4  },
];

const TOTAL_WEIGHT = SERVICES.reduce((s, sv) => s + sv.weight, 0);

function pickService() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const sv of SERVICES) { r -= sv.weight; if (r <= 0) return { ...sv }; }
  return { ...SERVICES[0] };
}

// Tech roster used by the demo seed. Resolved at seed-time from the
// tenant's actual employees collection so demo appointments land in
// real calendar columns. Falls back to the canonical Meraki roster
// only if no employees exist yet (e.g. fresh tenant). seedDemoData
// rebinds this via setSeedTechNames() before generating appointments.
const FALLBACK_TECH_NAMES = [
  'Yasmin D','Audriana L','Samantha T','Tess D','Elizabeth L',
  'Yan W','Jen T','Marisela I','Ana P','Jenesis B',
];
let TECH_NAMES = FALLBACK_TECH_NAMES;
function setSeedTechNames(names) {
  TECH_NAMES = (Array.isArray(names) && names.length) ? names : FALLBACK_TECH_NAMES;
}

// ── Date helpers ────────────────────────────────────────
function today() { return new Date(); }

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function offsetDate(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.getDay() === 0 || d.getDay() === 6;
}

function randomTimeStr() {
  const hour = 9 + Math.floor(Math.random() * 10); // 9am–6pm
  const min  = Math.random() < 0.5 ? '00' : '30';
  return `${String(hour).padStart(2,'0')}:${min}`;
}

// ── Build appointment list ──────────────────────────────
// 40% of demo appointments come in flagged "specifically requested",
// 30% "auto-assigned" (online booking with no preference), and 30%
// "scheduler" (front-desk staff scheduled it). Drives the ⭐/🎲/📋 icon
// distribution on the schedule.
function randomRequestType() {
  const r = Math.random();
  if (r < 0.40) return 'specific';
  if (r < 0.70) return 'auto';
  return 'scheduler';
}

// Pick a tech + request type for a given client. If the client has a
// favoriteTech, 75% of their appts go to that tech with techRequestType
// 'specific' — creating realistic clusters of "regulars" you can spot on the
// calendar by the repeating ⭐ + same tech + same client pattern.
function pickTechAndType(client) {
  if (!client) {
    // Walk-ins: front desk picks the tech.
    return { tech: TECH_NAMES[Math.floor(Math.random() * TECH_NAMES.length)], techRequestType: 'scheduler' };
  }
  const fav = client.favoriteTech;
  if (fav) {
    const r = Math.random();
    if (r < 0.75) return { tech: fav, techRequestType: 'specific' };
    if (r < 0.90) return { tech: TECH_NAMES[Math.floor(Math.random() * TECH_NAMES.length)], techRequestType: 'specific' };
    return { tech: TECH_NAMES[Math.floor(Math.random() * TECH_NAMES.length)], techRequestType: Math.random() < 0.5 ? 'auto' : 'scheduler' };
  }
  // No favorite — uniform distribution.
  return {
    tech: TECH_NAMES[Math.floor(Math.random() * TECH_NAMES.length)],
    techRequestType: randomRequestType(),
  };
}

function buildAppointments(clientRecords, celebRecords) {
  const appts = [];
  const base  = today();
  const todayStr = localDateStr(base);

  // Past 400 days (~13 months) — ~30% walk-ins, random salon volume
  for (let d = 1; d <= 400; d++) {
    const date      = offsetDate(base, -d);
    const weekend   = isWeekend(date);
    const countBase = weekend ? 10 : 7;
    const count     = countBase + Math.floor(Math.random() * 4) - 1;
    for (let a = 0; a < count; a++) {
      const isWalkin = Math.random() < 0.30;
      const svc      = pickService();
      const addAddon = Math.random() < 0.25;
      const services = [svc];
      if (addAddon) {
        const addon = SERVICES.slice(10)[Math.floor(Math.random() * 5)];
        if (addon.name !== svc.name) services.push({ ...addon });
      }
      const duration = services.reduce((s, sv) => s + sv.duration, 0);
      if (isWalkin) {
        const { tech, techRequestType } = pickTechAndType(null);
        appts.push({
          clientId: '', clientName: 'Walk-in',
          techName: tech, services, date,
          startTime: randomTimeStr(), duration, notes: '', status: 'done', techRequestType, _demo: true,
        });
      } else {
        const client = clientRecords[Math.floor(Math.random() * clientRecords.length)];
        const { tech, techRequestType } = pickTechAndType(client);
        appts.push({
          clientId: client.id, clientName: client.name,
          techName: tech, services, date,
          startTime: randomTimeStr(), duration, notes: '', status: 'done', techRequestType, _demo: true,
        });
      }
    }
  }

  // Today — 65-90% utilization per tech, status: scheduled
  const todayIsWknd  = isWeekend(todayStr);
  const maxPerTech   = todayIsWknd ? 7 : 6;
  const salonFactor  = 0.65 + Math.random() * 0.25; // 65–90%
  for (const tech of TECH_NAMES) {
    const techFactor = 0.7 + Math.random() * 0.3;
    const count      = Math.round(salonFactor * techFactor * maxPerTech);
    for (let a = 0; a < count; a++) {
      const slotHour  = 9 + Math.floor((a / maxPerTech) * 9);
      const slotMin   = Math.random() < 0.5 ? '00' : '30';
      const startTime = `${String(Math.min(slotHour, 18)).padStart(2, '0')}:${slotMin}`;
      const svc       = pickService();
      const client    = clientRecords[Math.floor(Math.random() * clientRecords.length)];
      appts.push({
        clientId: client.id, clientName: client.name,
        techName: tech, services: [{ ...svc }], date: todayStr, startTime,
        duration: svc.duration, notes: '', status: 'scheduled', techRequestType: randomRequestType(), _demo: true,
      });
    }
  }

  // Future 30 days — per-tech scheduling, 0–100% utilization per day
  for (let d = 1; d <= 30; d++) {
    const date       = offsetDate(base, d);
    const isWknd     = isWeekend(date);
    const maxPT      = isWknd ? 7 : 6;
    const salonBusy  = Math.random();

    for (const tech of TECH_NAMES) {
      const techBusy = Math.random();
      const count    = Math.round(salonBusy * techBusy * maxPT);
      for (let a = 0; a < count; a++) {
        const slotHour  = 9 + Math.floor((a / maxPT) * 9);
        const slotMin   = Math.random() < 0.5 ? '00' : '30';
        const startTime = `${String(Math.min(slotHour, 18)).padStart(2, '0')}:${slotMin}`;
        const svc       = pickService();
        const client    = clientRecords[Math.floor(Math.random() * clientRecords.length)];
        appts.push({
          clientId: client.id, clientName: client.name,
          techName: tech, services: [{ ...svc }], date, startTime,
          duration: svc.duration, notes: '', status: 'scheduled', techRequestType: randomRequestType(), _demo: true,
        });
      }
    }
  }

  // Guarantee every celebrity has 2-4 past appointments + possibly a future one
  for (const celeb of celebRecords) {
    const pastCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pastCount; i++) {
      const daysAgo = 1 + Math.floor(Math.random() * 119);
      const date    = offsetDate(base, -daysAgo);
      const { tech, techRequestType } = pickTechAndType(celeb);
      const svc     = pickService();
      appts.push({
        clientId: celeb.id, clientName: celeb.name,
        techName: tech, services: [{ ...svc }], date,
        startTime: randomTimeStr(), duration: svc.duration,
        notes: 'VIP appointment', status: 'done', techRequestType, _demo: true,
      });
    }
    // ~40% chance of a future appointment (next 30 days)
    if (Math.random() < 0.4) {
      const daysAhead = 1 + Math.floor(Math.random() * 29);
      const date      = offsetDate(base, daysAhead);
      const { tech, techRequestType } = pickTechAndType(celeb);
      const svc       = pickService();
      appts.push({
        clientId: celeb.id, clientName: celeb.name,
        techName: tech, services: [{ ...svc }], date,
        startTime: randomTimeStr(), duration: svc.duration,
        notes: 'VIP appointment', status: 'scheduled', techRequestType, _demo: true,
      });
    }
  }

  return appts;
}

// ── Seed ───────────────────────────────────────────────
export async function seedDemoData(onProgress) {
  // Bind the tech roster to the tenant's actual active employees so
  // generated appointments land in real calendar columns. Without this,
  // appointments reference techNames that no employee record matches and
  // the schedule grid renders empty even though appts exist in Firestore.
  const employees = await fetchEmployees();
  const activeNames = employees.filter(e => e.active !== false).map(e => e.name).filter(Boolean);
  setSeedTechNames(activeNames);
  onProgress?.(`Using tech roster: ${TECH_NAMES.join(', ')}`);

  const clientDefs = generateClients();
  const celebDefs  = generateCelebrities();

  onProgress?.(`Creating ${clientDefs.length} clients…`);
  const clientRecords = [];
  for (let i = 0; i < clientDefs.length; i++) {
    const id = await createClient(clientDefs[i]);
    clientRecords.push({ id, name: clientDefs[i].name, favoriteTech: clientDefs[i].favoriteTech || '' });
    if ((i + 1) % 50 === 0) onProgress?.(`Clients: ${i + 1} / ${clientDefs.length}`);
  }

  onProgress?.(`Creating ${celebDefs.length} celebrity clients…`);
  const celebRecords = [];
  for (let i = 0; i < celebDefs.length; i++) {
    const id = await createClient(celebDefs[i]);
    celebRecords.push({ id, name: celebDefs[i].name, favoriteTech: celebDefs[i].favoriteTech || '' });
  }

  const allClients = [...clientRecords, ...celebRecords];
  const apptDefs   = buildAppointments(allClients, celebRecords);
  onProgress?.(`Creating ${apptDefs.length} appointments…`);
  for (let i = 0; i < apptDefs.length; i++) {
    await createAppointment(apptDefs[i]);
    if ((i + 1) % 50 === 0) onProgress?.(`Appointments: ${i + 1} / ${apptDefs.length}`);
  }

  onProgress?.('Done!');
  return { clients: clientRecords.length + celebRecords.length, appointments: apptDefs.length };
}

// ── Add future appointments (top-up, days 31–60) ───────
export async function addFutureAppointments(onProgress) {
  onProgress?.('Fetching demo clients…');
  const demoClients = await fetchDemoClients();
  if (!demoClients.length) {
    onProgress?.('No demo clients found — seed demo data first.');
    return { appointments: 0 };
  }

  const clientRecords = demoClients.map(c => ({ id: c.id, name: c.name }));
  const celebRecords  = demoClients.filter(c => c._celebrity).map(c => ({ id: c.id, name: c.name }));
  const base = today();
  const appts = [];

  for (let d = 31; d <= 60; d++) {
    const date       = offsetDate(base, d);
    const isWknd     = isWeekend(date);
    const maxPerTech = isWknd ? 7 : 6;
    const salonBusy  = Math.random();

    for (const tech of TECH_NAMES) {
      const techBusy = Math.random();
      const count    = Math.round(salonBusy * techBusy * maxPerTech);
      for (let a = 0; a < count; a++) {
        const slotHour  = 9 + Math.floor((a / maxPerTech) * 9);
        const slotMin   = Math.random() < 0.5 ? '00' : '30';
        const startTime = `${String(Math.min(slotHour, 18)).padStart(2, '0')}:${slotMin}`;
        const svc       = pickService();
        const client    = clientRecords[Math.floor(Math.random() * clientRecords.length)];
        appts.push({
          clientId: client.id, clientName: client.name,
          techName: tech, services: [{ ...svc }], date, startTime,
          duration: svc.duration, notes: '', status: 'scheduled', techRequestType: randomRequestType(), _demo: true,
        });
      }
    }
  }

  for (const celeb of celebRecords) {
    if (Math.random() < 0.35) {
      const daysAhead = 31 + Math.floor(Math.random() * 29);
      const date      = offsetDate(base, daysAhead);
      const tech      = TECH_NAMES[Math.floor(Math.random() * TECH_NAMES.length)];
      const svc       = pickService();
      appts.push({
        clientId: celeb.id, clientName: celeb.name,
        techName: tech, services: [{ ...svc }], date,
        startTime: randomTimeStr(), duration: svc.duration,
        notes: 'VIP appointment', status: 'scheduled', techRequestType: randomRequestType(), _demo: true,
      });
    }
  }

  onProgress?.(`Creating ${appts.length} appointments…`);
  for (let i = 0; i < appts.length; i++) {
    await createAppointment(appts[i]);
    if ((i + 1) % 20 === 0) onProgress?.(`Appointments: ${i + 1} / ${appts.length}`);
  }

  onProgress?.('Done!');
  return { appointments: appts.length };
}

// ── Backfill receipts + statuses ───────────────────────
// For all past demo appointments currently marked "done":
//   75% keep "done" and get a synthetic receipt with full payment data
//   15% flip to "cancelled" (no receipt)
//   10% flip to "no_show"   (no receipt)
// The synthetic receipt mirrors what CheckoutModal would write — random method
// (60% card, 35% cash, 5% venmo), random tip (15–25%), tax at 7.5%, and a CC
// fee on card transactions. This makes the Reports → Transactions tab show
// realistic per-tech / per-method breakdowns immediately.
export async function backfillDemoTransactions(onProgress) {
  onProgress?.('Loading demo appointments…');
  const all = await fetchDemoAppointments();
  const todayDate = localDateStr(today());
  // Only past 'done' appointments — leave today's scheduled and future alone.
  const candidates = all.filter(a => a.status === 'done' && a.date < todayDate);
  if (candidates.length === 0) {
    onProgress?.('No past done appointments found. Seed demo data first.');
    return { receipts: 0, cancelled: 0, noShow: 0 };
  }

  // Pass 0a: ensure every demo client has a favoriteTech. ~60% get one;
  // celebrities get one with 90% probability. Drives the realistic clusters
  // (regulars seeing the same tech each visit) below.
  onProgress?.('Assigning favorite techs to demo clients…');
  const demoClients = await fetchDemoClients().catch(() => []);
  const favTechByClient = new Map();
  for (let i = 0; i < demoClients.length; i++) {
    const c = demoClients[i];
    if (typeof c.favoriteTech === 'string') {
      favTechByClient.set(c.id, c.favoriteTech || '');
      continue;
    }
    const threshold = c._celebrity ? 0.9 : 0.6;
    const fav = Math.random() < threshold
      ? TECH_NAMES[Math.floor(Math.random() * TECH_NAMES.length)]
      : '';
    favTechByClient.set(c.id, fav);
    try {
      const { id, createdAt, ...data } = c;
      await saveClient(id, { ...data, favoriteTech: fav });
    } catch (e) { console.warn('[backfill fav]', c.id, e?.message || e); }
  }

  // Pass 0b: re-stamp techRequestType on every demo appointment, this time
  // biasing toward the client's favorite tech so the calendar shows the
  // realistic ⭐ clustering ("regulars always see Yan W"). For clients with a
  // favorite, 70% of their appts are realigned to that tech as 'specific'.
  onProgress?.(`Re-aligning request types on ${all.length} appointments…`);
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    try {
      const fav = a.clientId ? favTechByClient.get(a.clientId) : '';
      const update = { ...a };
      if (fav) {
        const r = Math.random();
        if (r < 0.70) {
          update.techRequestType = 'specific';
          update.techName = fav;
        } else if (r < 0.85) {
          update.techRequestType = 'specific';
        } else {
          update.techRequestType = Math.random() < 0.5 ? 'auto' : 'scheduler';
        }
      } else {
        update.techRequestType = randomRequestType();
      }
      await saveAppointment(a.id, update);
    } catch (e) { console.warn('[backfill rt]', a.id, e?.message || e); }
    if ((i + 1) % 100 === 0) onProgress?.(`Re-aligned ${i + 1} / ${all.length}…`);
  }

  onProgress?.(`Backfilling ${candidates.length} appointments…`);
  const TAX_RATE   = 7.5;
  const CC_FEE_PCT = 2.9;
  const CC_FEE_FLAT= 0.30;
  const TIP_PCTS   = [15, 18, 20, 22, 25];
  const METHODS    = [
    ...Array(60).fill('card'),
    ...Array(35).fill('cash'),
    ...Array(5).fill('venmo'),
  ];
  const round2 = n => Math.round(n * 100) / 100;

  let receiptCount = 0, cancelledCount = 0, noShowCount = 0;
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    const roll = Math.random();
    try {
      if (roll < 0.10) {
        // No-show
        await saveAppointment(a.id, { ...a, status: 'no_show' });
        noShowCount++;
      } else if (roll < 0.25) {
        // Cancelled
        await saveAppointment(a.id, { ...a, status: 'cancelled' });
        cancelledCount++;
      } else {
        // Done — build a payment + receipt
        const subtotal   = (a.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
        const tax        = round2(subtotal * TAX_RATE / 100);
        const tipPct     = TIP_PCTS[Math.floor(Math.random() * TIP_PCTS.length)];
        const tip        = round2(subtotal * tipPct / 100);
        const total      = round2(subtotal + tax + tip);
        const method     = METHODS[Math.floor(Math.random() * METHODS.length)];
        const ccFee      = method === 'card' ? round2(total * CC_FEE_PCT / 100 + CC_FEE_FLAT) : 0;
        const startISO   = `${a.date}T${(a.startTime || '12:00')}:00.000Z`;
        const payment = {
          subtotal, tax, taxRate: TAX_RATE,
          discountAmount: 0, promoAmount: 0,
          tip,
          charged: total - tip, total,
          method, ccFee, ccFeePct: CC_FEE_PCT, ccFeeFlat: CC_FEE_FLAT,
          techSplit: null,
          retailProducts: null,
          giftCardsSold: null,
          gcSalesTotal: 0,
          apptIds: [a.id],
          paidAt: startISO,
          amountForThisAppt: subtotal,
        };
        await saveAppointment(a.id, { ...a, payment });
        await createReceipt({
          _demo: true,
          clientId:    a.clientId || null,
          clientName:  a.clientName || 'Walk-in',
          clientEmail: null,
          techName:    a.techName || '',
          date:        a.date,
          startTime:   a.startTime || '',
          services:    (a.services || []).map(sv => ({ name: sv.name, price: sv.price, techName: a.techName })),
          retailProducts: null,
          giftCardsSold: null,
          apptIds:     [a.id],
          payment,
        });
        receiptCount++;
      }
    } catch (e) {
      console.warn('[backfill]', a.id, e?.message || e);
    }
    if ((i + 1) % 50 === 0) onProgress?.(`Backfilled ${i + 1} / ${candidates.length}…`);
  }

  // ── Gift card sales ─────────────────────────────────
  // ~40 standalone sales spread over the past 12 months, no service / no tech,
  // amounts $25/$50/$75/$100/$150/$200, paid mostly by card.
  const GC_AMOUNTS = [25, 50, 75, 100, 100, 150, 200];
  const GC_COUNT   = 40;
  const allClients = await fetchDemoClients().catch(() => []);
  let gcSaleCount = 0;
  onProgress?.('Seeding gift card sales…');
  for (let g = 0; g < GC_COUNT; g++) {
    try {
      const daysAgo = 1 + Math.floor(Math.random() * 360);
      const date    = offsetDate(today(), -daysAgo);
      const amount  = GC_AMOUNTS[Math.floor(Math.random() * GC_AMOUNTS.length)];
      const buyer   = allClients.length > 0 && Math.random() < 0.7
        ? allClients[Math.floor(Math.random() * allClients.length)]
        : null;
      const code    = `MK-${randomCode(6)}`;
      const giftCardId = await createGiftCard({
        _demo: true,
        code,
        balance: amount,
        originalAmount: amount,
        recipientName: buyer?.name || `Walk-in #${g + 1}`,
        recipientEmail: null,
        soldAt: `${date}T${randomTimeStr()}:00.000Z`,
        soldVia: 'demo_seed',
        active: true,
      });
      const method = METHODS[Math.floor(Math.random() * METHODS.length)];
      const ccFee  = method === 'card' ? round2(amount * CC_FEE_PCT / 100 + CC_FEE_FLAT) : 0;
      const startISO = `${date}T${(randomTimeStr())}:00.000Z`;
      const payment = {
        subtotal: amount, tax: 0, taxRate: TAX_RATE,
        discountAmount: 0, promoAmount: 0,
        tip: 0, charged: amount, total: amount,
        method, ccFee, ccFeePct: CC_FEE_PCT, ccFeeFlat: CC_FEE_FLAT,
        techSplit: null, retailProducts: null,
        gcSalesTotal: amount,
        giftCardsSold: [{ id: giftCardId, code, amount, recipientName: buyer?.name || null, recipientEmail: null }],
        apptIds: [],
        paidAt: startISO,
      };
      await createReceipt({
        _demo: true,
        clientId: buyer?.id || null,
        clientName: buyer?.name || 'Walk-in retail',
        clientEmail: null,
        techName: '',
        date,
        startTime: '',
        services: [],
        retailProducts: null,
        giftCardsSold: payment.giftCardsSold,
        apptIds: [],
        payment,
      });
      gcSaleCount++;
    } catch (e) {
      console.warn('[backfill gc]', e?.message || e);
    }
  }

  // ── Retail product sales ────────────────────────────
  // ~50 standalone retail purchases (no service) across active products.
  let productSaleCount = 0;
  const products = await fetchProducts().catch(() => []);
  const sellableProducts = products.filter(p => p.active !== false && (Number(p.price) || 0) > 0);
  if (sellableProducts.length > 0) {
    onProgress?.('Seeding retail product sales…');
    const PRODUCT_SALE_COUNT = 50;
    for (let s = 0; s < PRODUCT_SALE_COUNT; s++) {
      try {
        const daysAgo = 1 + Math.floor(Math.random() * 360);
        const date    = offsetDate(today(), -daysAgo);
        // 1-3 different products per ticket
        const lineCount = 1 + Math.floor(Math.random() * 3);
        const lines = [];
        for (let l = 0; l < lineCount; l++) {
          const p   = sellableProducts[Math.floor(Math.random() * sellableProducts.length)];
          const qty = 1 + Math.floor(Math.random() * 2); // 1 or 2
          if (lines.find(x => x.id === p.id)) continue;
          lines.push({ id: p.id, name: p.name, price: Number(p.price) || 0, qty });
        }
        const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
        if (subtotal <= 0) continue;
        const tax    = round2(subtotal * TAX_RATE / 100);
        const total  = round2(subtotal + tax);
        const method = METHODS[Math.floor(Math.random() * METHODS.length)];
        const ccFee  = method === 'card' ? round2(total * CC_FEE_PCT / 100 + CC_FEE_FLAT) : 0;
        const buyer  = allClients.length > 0 && Math.random() < 0.6
          ? allClients[Math.floor(Math.random() * allClients.length)]
          : null;
        const startISO = `${date}T${randomTimeStr()}:00.000Z`;
        const payment = {
          subtotal, tax, taxRate: TAX_RATE,
          discountAmount: 0, promoAmount: 0,
          tip: 0, charged: total, total,
          method, ccFee, ccFeePct: CC_FEE_PCT, ccFeeFlat: CC_FEE_FLAT,
          techSplit: null, retailProducts: lines,
          gcSalesTotal: 0, giftCardsSold: null,
          apptIds: [],
          paidAt: startISO,
        };
        await createReceipt({
          _demo: true,
          clientId: buyer?.id || null,
          clientName: buyer?.name || 'Walk-in retail',
          clientEmail: null,
          techName: '',
          date,
          startTime: '',
          services: [],
          retailProducts: lines,
          giftCardsSold: null,
          apptIds: [],
          payment,
        });
        productSaleCount++;
      } catch (e) {
        console.warn('[backfill product]', e?.message || e);
      }
    }
  }

  onProgress?.('Done!');
  return { receipts: receiptCount, cancelled: cancelledCount, noShow: noShowCount, giftCardSales: gcSaleCount, productSales: productSaleCount };
}

function randomCode(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

// ── Helpers for the auxiliary seeders below ─────────────
const dPlus  = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const isoNow = () => new Date().toISOString();

// ── Promo codes ────────────────────────────────────────
export async function seedDemoPromos(onProgress) {
  const promos = [
    { code: 'WELCOME20', type: 'percent', value: 20, active: true,  startDate: dPlus(-30), endDate: dPlus(60), singleUse: false, usedCount: 12, description: 'Welcome 20% off any service for new clients' },
    { code: 'BIRTHDAY10',type: 'amount',  value: 10, active: true,  startDate: dPlus(-365),endDate: dPlus(365),singleUse: false, usedCount: 47, description: '$10 off in your birthday month' },
    { code: 'REFER15',   type: 'percent', value: 15, active: true,  startDate: dPlus(-90), endDate: dPlus(90), singleUse: false, usedCount: 8,  description: 'Refer-a-friend 15% off for both' },
    { code: 'SUMMER25',  type: 'percent', value: 25, active: false, startDate: dPlus(-120),endDate: dPlus(-30),singleUse: false, usedCount: 31, description: 'Summer special — expired' },
    { code: 'VIPMOM',    type: 'amount',  value: 20, active: true,  startDate: dPlus(-60), endDate: dPlus(60), singleUse: false, usedCount: 5,  description: '$20 off — Mother\'s Day VIPs' },
    { code: 'BLACKFRI30',type: 'percent', value: 30, active: true,  startDate: dPlus(-7),  endDate: dPlus(7),  singleUse: false, usedCount: 0,  description: 'Black Friday flash 30% off' },
  ];
  onProgress?.(`Creating ${promos.length} promo codes…`);
  for (const p of promos) {
    await createPromoCode({ ...p, _demo: true });
  }
  return promos.length;
}

// ── Memberships (1 plan + ~20 active subscribers) ──────
export async function seedDemoMemberships(onProgress, allClients) {
  onProgress?.('Creating membership plan…');
  const planId = await createMembershipPlan({
    name: 'VIP Monthly',
    price: 79,
    billingPeriod: 'monthly',
    description: '1 manicure + 1 pedicure per month, 10% off all retail, priority booking.',
    perks: ['1 manicure / month', '1 pedicure / month', '10% off retail', 'Priority booking'],
    active: true,
    _demo: true,
  });

  // Pick ~20 clients from the celebrity list for active memberships (they
  // tend to be the higher-spend names so it's plausible they'd be VIPs).
  const candidates = allClients.filter(c => c.name && allClients.indexOf(c) < 50).slice(0, 20);
  onProgress?.(`Subscribing ${candidates.length} VIP members…`);
  let count = 0;
  for (const client of candidates) {
    await createMembership({
      planId,
      clientId: client.id,
      clientName: client.name,
      status: 'active',
      startedAt: dPlus(-Math.floor(Math.random() * 180)) + 'T12:00:00.000Z',
      _demo: true,
    });
    count++;
  }
  return { plans: 1, members: count };
}

// ── Time off entries for techs ─────────────────────────
export async function seedDemoTimeOff(onProgress) {
  // Mirror the demo techs created by onboard-test-tenant; for Meraki this
  // also matches first names so the entries actually attach to a real tech.
  const entries = [
    { techName: 'Alex Rivers',   type: 'vacation', startDate: dPlus(7),  endDate: dPlus(11), allDay: true,  reason: 'Family vacation' },
    { techName: 'Jamie Chen',    type: 'sick',     startDate: dPlus(-3), endDate: dPlus(-3), allDay: true,  reason: 'Out sick' },
    { techName: 'Morgan Lee',    type: 'personal', startDate: dPlus(14), endDate: dPlus(14), allDay: false, startTime: '13:00', endTime: '17:00', reason: 'Doctor appointment' },
    { techName: 'Yasmin D',      type: 'vacation', startDate: dPlus(21), endDate: dPlus(28), allDay: true,  reason: 'Vacation' },
    { techName: 'Samantha T',    type: 'personal', startDate: dPlus(-10),endDate: dPlus(-10),allDay: true,  reason: 'Personal' },
  ];
  onProgress?.(`Creating ${entries.length} time-off entries…`);
  for (const e of entries) {
    await createTimeOff({ ...e, _demo: true });
  }
  return entries.length;
}

// ── Sample Google reviews (cached on data/googleReviews) ──
export async function seedDemoReviews(onProgress) {
  const reviews = [
    { name: 'Brittany Walsh',   rating: 5, text: 'Best gel manicure I have ever had. Booking was super easy and they confirmed the same day.',                date: '2 weeks ago',  photoUrl: null, authorUrl: null },
    { name: 'Sarah Williams',   rating: 5, text: 'Love this place! Alex did a perfect French set, will be back monthly.',                                     date: '3 weeks ago',  photoUrl: null, authorUrl: null },
    { name: 'Vanessa Martinez', rating: 5, text: 'Spa pedicure was incredible. Clean, calm, and Jamie was so attentive.',                                     date: '1 month ago',  photoUrl: null, authorUrl: null },
    { name: 'Olivia Brooks',    rating: 4, text: 'Great service, just wish they had more weekend availability. Polish lasted 3 weeks!',                       date: '1 month ago',  photoUrl: null, authorUrl: null },
    { name: 'Hannah Patel',     rating: 5, text: 'Morgan is a Gel-X queen. Got compliments on my nails for two solid weeks.',                                date: '2 months ago', photoUrl: null, authorUrl: null },
    { name: 'Kayla Nguyen',     rating: 5, text: 'My birthday treat to myself — felt so welcomed. Definitely my new spot.',                                  date: '2 months ago', photoUrl: null, authorUrl: null },
    { name: 'Emily Carter',     rating: 5, text: 'I have tried every salon in town. This is the only one I trust with my nails now.',                        date: '3 months ago', photoUrl: null, authorUrl: null },
    { name: 'Nicole Cooper',    rating: 4, text: 'Loved the manicure, parking is a tiny bit tricky. Worth it though!',                                       date: '3 months ago', photoUrl: null, authorUrl: null },
  ];
  onProgress?.(`Caching ${reviews.length} Google reviews…`);
  const wf = await fetchWebfrontConfig().catch(() => ({}));
  await saveWebfrontConfig({
    ...(wf || {}),
    googleReviews: {
      reviews,
      rating: 4.9,
      userRatingCount: 87,
      refreshedAt: isoNow(),
      _demo: true,
    },
  });
  return reviews.length;
}

// ── HR bonuses ─────────────────────────────────────────
export async function seedDemoBonuses(onProgress) {
  const bonuses = [
    { techName: 'Alex Rivers',   amount: 250, reason: 'Top retail seller — Q3',           date: dPlus(-90) },
    { techName: 'Jamie Chen',    amount: 150, reason: 'Perfect attendance bonus',         date: dPlus(-60) },
    { techName: 'Morgan Lee',    amount: 200, reason: 'Most 5-star reviews this quarter', date: dPlus(-30) },
    { techName: 'Alex Rivers',   amount: 500, reason: 'Holiday bonus 2025',               date: dPlus(-180) },
    { techName: 'Yasmin D',      amount: 300, reason: 'Employee of the month',            date: dPlus(-15) },
  ];
  onProgress?.(`Creating ${bonuses.length} bonuses…`);
  for (const b of bonuses) {
    await createBonus({ ...b, _demo: true });
  }
  return bonuses.length;
}

// ── Walk-in queue history (last 30 days) ───────────────
// Not necessarily today's queue — most are completed entries that show up
// in the queue / arrivals reports.
export async function seedDemoWaitlist(onProgress, allClients) {
  const SVC_NAMES = ['Classic Manicure', 'Gel Manicure', 'Spa Pedicure', 'Gel-X Full Set'];
  const TECHS     = ['Alex Rivers', 'Jamie Chen', 'Morgan Lee', 'Any'];
  const STATUSES  = ['seated', 'seated', 'seated', 'cancelled', 'no_show'];
  const entries = [];
  for (let i = 0; i < 20; i++) {
    const c = allClients[Math.floor(Math.random() * allClients.length)];
    const daysAgo = 1 + Math.floor(Math.random() * 30);
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const date = d.toISOString().slice(0, 10);
    entries.push({
      clientName:  c.name,
      clientPhone: '',
      clientId:    c.id,
      serviceName: SVC_NAMES[Math.floor(Math.random() * SVC_NAMES.length)],
      techName:    TECHS[Math.floor(Math.random() * TECHS.length)],
      isWalkIn:    true,
      hasAppointment: false,
      status:      STATUSES[Math.floor(Math.random() * STATUSES.length)],
      date,
      addedAt:     d.toISOString(),
      _demo:       true,
    });
  }
  onProgress?.(`Creating ${entries.length} walk-in queue entries…`);
  // Use the raw collection (addToWaitlist forces today's date — we want
  // historical entries here).
  for (const e of entries) {
    await import('firebase/firestore').then(({ collection: c, addDoc }) =>
      addDoc(c(db, 'tenants', TENANT_ID, 'waitlist'), e)
    );
  }
  return entries.length;
}

// ── Marketing campaigns (2 sent + 1 scheduled) ─────────
export async function seedDemoCampaigns(onProgress) {
  const sent = [
    {
      name: 'Summer Sale 2026',
      subject: '☀️ 25% off all services — this week only',
      body: 'Hi {firstName}!\n\nSummer is here and so is our biggest sale of the year. Use code SUMMER25 at checkout for 25% off any service. Book before Friday — appointments are filling up fast.\n\nWe can\'t wait to see you 💅',
      channel: 'email',
      status: 'sent',
      sentAt: dPlus(-90) + 'T10:00:00.000Z',
      sentCount: 327,
      failCount: 4,
    },
    {
      name: 'Holiday Hours Update',
      subject: 'Holiday hours + last appointments before Christmas',
      body: 'Hi {firstName}, just a quick heads-up on our holiday schedule. We\'re open through Dec 23 and back Dec 28. Book your last appointment of the year now — slots are going quick!',
      channel: 'email',
      status: 'sent',
      sentAt: dPlus(-30) + 'T09:00:00.000Z',
      sentCount: 289,
      failCount: 2,
    },
  ];
  const scheduled = {
    name: 'Black Friday Flash',
    subject: 'Black Friday: 30% off — code inside',
    body: 'Hi {firstName}!\n\nOur biggest sale of the season starts Friday. Use {promoCode} at checkout for 30% off any service. Limited slots — book early!',
    channel: 'email',
    status: 'scheduled',
    scheduleAt: dPlus(7) + 'T08:00:00.000Z',
    promoCode: 'BLACKFRI30',
  };
  onProgress?.(`Creating ${sent.length + 1} marketing campaigns…`);
  for (const c of sent)  await createCampaign({ ...c, _demo: true });
  await createCampaign({ ...scheduled, _demo: true });
  return sent.length + 1;
}

// ── Master seeder ──────────────────────────────────────
// Orchestrates every demo seeder above into one flow. Resumable in spirit
// — each sub-seeder is idempotent against `_demo: true` so re-running adds
// duplicates rather than failing. Use clearDemoData first if you need a
// clean slate.
// ── Employee contact + TIN backfill ────────────────────
// Pool of Columbus-area addresses used to fill demo data for employees who
// aren't in SEED_EMPLOYEES (works for any tech, named or freshly added).
const FALLBACK_ADDRS = [
  { address: '215 Graceland Blvd', city: 'Columbus', state: 'OH', zip: '43214' },
  { address: '4400 N High St',     city: 'Columbus', state: 'OH', zip: '43202' },
  { address: '7500 Sawmill Rd',    city: 'Columbus', state: 'OH', zip: '43235' },
  { address: '1100 Neil Ave',      city: 'Columbus', state: 'OH', zip: '43201' },
  { address: '5200 Brand Rd',      city: 'Dublin',   state: 'OH', zip: '43017' },
  { address: '340 W Norwich Ave',  city: 'Columbus', state: 'OH', zip: '43201' },
  { address: '1650 Old Henderson Rd', city: 'Columbus', state: 'OH', zip: '43220' },
  { address: '3800 Riverside Dr',  city: 'Columbus', state: 'OH', zip: '43221' },
];

// Deterministic 9-digit demo TIN in SSN form (XXX-XX-XXXX). Synthetic — not real.
function generateDemoTin(i) {
  const a = String(100 + ((i * 173) % 800)).padStart(3, '0');
  const b = String(10  + ((i * 47)  % 90)).padStart(2, '0');
  const c = String(1000 + ((i * 281) % 9000)).padStart(4, '0');
  return `${a}-${b}-${c}`;
}

// Fills demo contact + TIN data on every existing employee. Idempotent:
// only fills falsy/empty fields; real values are preserved. Optional
// settings + updateSettings args also seed salon-level EIN/address.
// Shared between EmployeesAdmin's "✚ Fill demo contact/TIN" button and
// the seedFullDemo orchestrator so both routes do the same work.
export async function seedDemoEmployeeContactInfo(onProgress, opts = {}) {
  const { settings, updateSettings } = opts;
  const fresh = await fetchEmployeesWithComp();
  let patched = 0;
  let fieldsFilled = 0;
  for (let i = 0; i < fresh.length; i++) {
    const emp  = fresh[i];
    const seed = SEED_EMPLOYEES.find(s => s.name === emp.name) || {};
    const fb   = FALLBACK_ADDRS[i % FALLBACK_ADDRS.length];
    const slug = (emp.name || `tech${i}`).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');

    const candidates = {
      phone:   seed.phone   || `(614) 555-${String(1000 + (i * 137) % 9000).padStart(4, '0')}`,
      email:   seed.email   || `${slug || 'tech'}@example.com`,
      address: seed.address || fb.address,
      city:    seed.city    || fb.city,
      state:   seed.state   || fb.state,
      zip:     seed.zip     || fb.zip,
      tin:     seed.tin     || generateDemoTin(i),
    };
    const updates = {};
    Object.entries(candidates).forEach(([k, v]) => {
      const cur = emp[k];
      if ((cur === undefined || cur === null || cur === '') && v) updates[k] = v;
    });
    if (Object.keys(updates).length > 0) {
      await saveEmployee(emp.id, { ...emp, ...updates });
      patched++;
      fieldsFilled += Object.keys(updates).length;
      onProgress?.(`Filled ${patched}/${fresh.length} techs (${fieldsFilled} fields)`);
    }
  }

  let salonFilled = 0;
  if (settings && typeof updateSettings === 'function') {
    const salonDefaults = {
      ein:          '83-2917458',
      brandAddress: '4500 N High St',
      brandCity:    'Columbus',
      brandState:   'OH',
      brandZip:     '43214',
      brandPhone:   '(614) 555-0100',
    };
    const salonUpdates = {};
    Object.entries(salonDefaults).forEach(([k, v]) => {
      const cur = settings?.[k];
      if ((cur === undefined || cur === null || cur === '') && v) salonUpdates[k] = v;
    });
    if (Object.keys(salonUpdates).length > 0) {
      await updateSettings({ ...settings, ...salonUpdates });
      salonFilled = Object.keys(salonUpdates).length;
    }
  }

  return { patched, total: fresh.length, fieldsFilled, salonFilled };
}

// Ensures an employee record exists for the currently-signed-in admin so
// the demo includes the "admin who is also a tech" persona out of the box.
// Idempotent: if an employee with this email already exists, returns it
// unchanged. Otherwise creates one with sensible defaults.
//
// Without this, the demo's mobile profile screen shows "No employee record
// linked to this account" for the founder, and the web "My tech view"
// toggle is dim — both real product features whose demo paths break without
// an employee record matching the signed-in admin's email.
export async function seedAdminAsTechEmployee(gUser, onProgress) {
  if (!gUser?.email) return { created: false, reason: 'no_signed_in_user' };
  const emailLower = gUser.email.toLowerCase();
  const existing = await fetchEmployees();
  const match = existing.find(e => (e.email || '').toLowerCase() === emailLower);
  if (match) {
    onProgress?.(`Employee record for ${gUser.email} already exists`);
    return { created: false, employee: match };
  }

  const displayName = gUser.displayName || gUser.email.split('@')[0];
  const i = existing.length;
  const fb = FALLBACK_ADDRS[i % FALLBACK_ADDRS.length];
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');

  const data = {
    name:        displayName,
    email:       gUser.email,
    phone:       `(614) 555-${String(1000 + (i * 137) % 9000).padStart(4, '0')}`,
    photo:       gUser.photoURL || '',
    address:     fb.address,
    city:        fb.city,
    state:       fb.state,
    zip:         fb.zip,
    tin:         generateDemoTin(i),
    active:      true,
    sortOrder:   i + 1,
    serviceIds:  [],
    workDays:    {
      Mon: { on: true, start: '09:00', end: '18:00' },
      Tue: { on: true, start: '09:00', end: '18:00' },
      Wed: { on: true, start: '09:00', end: '18:00' },
      Thu: { on: true, start: '09:00', end: '18:00' },
      Fri: { on: true, start: '09:00', end: '18:00' },
      Sat: { on: true, start: '09:00', end: '18:00' },
      Sun: { on: false, start: '09:00', end: '18:00' },
    },
    _demo:       true,
  };
  const id = await createEmployee(data);
  onProgress?.(`Created admin-as-tech employee: ${displayName}`);
  return { created: true, employee: { id, ...data } };
}

export async function seedFullDemo(onProgress, opts = {}) {
  const { gUser, settings, updateSettings } = opts;
  const stats = {};

  // Employees first — appointments need a real tech roster to land in
  // calendar columns. Admin-as-tech runs before contact-fill so the
  // founder's new record gets the same backfill treatment as the others.
  onProgress?.('Step 1/11 · Ensuring admin-as-tech employee record…');
  const adminTech = await seedAdminAsTechEmployee(gUser, onProgress);
  stats.adminAsTech = adminTech.created ? 'created' : (adminTech.employee ? 'already_existed' : 'skipped_no_user');

  onProgress?.('Step 2/11 · Filling demo contact/TIN for all techs + salon defaults…');
  const contact = await seedDemoEmployeeContactInfo(onProgress, { settings, updateSettings });
  stats.employeesFilled = contact.patched;
  stats.fieldsFilled    = contact.fieldsFilled;
  stats.salonFilled     = contact.salonFilled;

  onProgress?.('Step 3/11 · Seeding products…');
  await seedProductCatalog(onProgress);
  stats.products = 25;

  onProgress?.('Step 4/11 · Seeding clients + appointments…');
  const base = await seedDemoData(onProgress);
  stats.clients      = base.clients;
  stats.appointments = base.appointments;

  // Re-fetch clients now that they're in Firestore — the auxiliary
  // seeders need real ids.
  const allClients = await fetchDemoClients();

  onProgress?.('Step 5/11 · Backfilling receipts (services, gift cards, retail)…');
  const tx = await backfillDemoTransactions(onProgress);
  stats.receipts        = tx.receipts;
  stats.cancelled       = tx.cancelled;
  stats.noShow          = tx.noShow;
  stats.giftCardSales   = tx.giftCardSales || 0;
  stats.productSales    = tx.productSales || 0;

  onProgress?.('Step 6/11 · Seeding promo codes…');
  stats.promos = await seedDemoPromos(onProgress);

  onProgress?.('Step 7/11 · Seeding memberships…');
  const mem = await seedDemoMemberships(onProgress, allClients);
  stats.memberships = mem.members;

  onProgress?.('Step 8/11 · Seeding time off…');
  stats.timeOff = await seedDemoTimeOff(onProgress);

  onProgress?.('Step 9/11 · Seeding Google reviews…');
  stats.reviews = await seedDemoReviews(onProgress);

  onProgress?.('Step 10/11 · Seeding HR bonuses…');
  stats.bonuses = await seedDemoBonuses(onProgress);

  onProgress?.('Step 11/11 · Seeding walk-in queue history + marketing campaigns…');
  stats.waitlist  = await seedDemoWaitlist(onProgress, allClients);
  stats.campaigns = await seedDemoCampaigns(onProgress);

  onProgress?.('Done!');
  return stats;
}

// ── Clear ──────────────────────────────────────────────
export async function clearDemoData(onProgress) {
  onProgress?.('Finding demo clients…');
  const demoClients = await fetchDemoClients();
  onProgress?.(`Removing ${demoClients.length} clients…`);
  for (let i = 0; i < demoClients.length; i++) {
    await purgeClient(demoClients[i].id);
    if ((i + 1) % 50 === 0) onProgress?.(`Clients removed: ${i + 1} / ${demoClients.length}`);
  }

  onProgress?.('Finding demo appointments…');
  const demoAppts = await fetchDemoAppointments();
  onProgress?.(`Removing ${demoAppts.length} appointments…`);
  for (let i = 0; i < demoAppts.length; i++) {
    await purgeAppointment(demoAppts[i].id);
    if ((i + 1) % 50 === 0) onProgress?.(`Appointments removed: ${i + 1} / ${demoAppts.length}`);
  }

  onProgress?.('Finding demo receipts…');
  const demoReceipts = await fetchDemoReceipts();
  onProgress?.(`Removing ${demoReceipts.length} receipts…`);
  for (let i = 0; i < demoReceipts.length; i++) {
    await purgeReceipt(demoReceipts[i].id);
    if ((i + 1) % 50 === 0) onProgress?.(`Receipts removed: ${i + 1} / ${demoReceipts.length}`);
  }

  onProgress?.('Finding demo gift cards…');
  const demoGcs = await fetchDemoGiftCards();
  onProgress?.(`Removing ${demoGcs.length} gift cards…`);
  for (let i = 0; i < demoGcs.length; i++) {
    await purgeGiftCard(demoGcs[i].id);
    if ((i + 1) % 50 === 0) onProgress?.(`Gift cards removed: ${i + 1} / ${demoGcs.length}`);
  }

  // Helper: wipe all docs in a tenant collection that have _demo: true.
  // Used by the auxiliary seeders below — each writes the flag, this
  // function reads it back and deletes.
  async function wipeByDemoFlag(collName) {
    const col = collection(db, 'tenants', TENANT_ID, collName);
    const snap = await getDocs(query(col, where('_demo', '==', true)));
    for (const d of snap.docs) await deleteDoc(doc(col, d.id));
    return snap.size;
  }

  onProgress?.('Removing demo products…');
  const products = await wipeByDemoFlag('products');

  onProgress?.('Removing demo promo codes…');
  const promos = await wipeByDemoFlag('promoCodes');

  onProgress?.('Removing demo memberships + plans…');
  const memberships = await wipeByDemoFlag('memberships');
  const memPlans    = await wipeByDemoFlag('membershipPlans');

  onProgress?.('Removing demo time off…');
  const timeOff = await wipeByDemoFlag('timeOff');

  onProgress?.('Removing demo bonuses…');
  const bonuses = await wipeByDemoFlag('bonuses');

  onProgress?.('Removing demo waitlist entries…');
  const waitlist = await wipeByDemoFlag('waitlist');

  onProgress?.('Removing demo campaigns…');
  const campaigns = await wipeByDemoFlag('campaigns');

  // Demo Google reviews live on data/webfront.googleReviews._demo. Strip
  // them by overwriting the field with an empty value if they're flagged.
  onProgress?.('Clearing demo Google reviews…');
  let reviewsCleared = 0;
  try {
    const wf = await fetchWebfrontConfig();
    if (wf?.googleReviews?._demo) {
      await saveWebfrontConfig({ ...(wf || {}), googleReviews: null });
      reviewsCleared = (wf.googleReviews.reviews || []).length;
    }
  } catch { /* best-effort */ }

  onProgress?.('Done!');
  return {
    clients: demoClients.length, appointments: demoAppts.length,
    receipts: demoReceipts.length, giftCards: demoGcs.length,
    products, promos, memberships, memPlans, timeOff, bonuses, waitlist, campaigns,
    reviews: reviewsCleared,
  };
}
