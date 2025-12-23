/**
 * Comprehensive service categories based on Airtasker and India-specific services
 * This file should be kept in sync across all services (user-service, admin-service, admin-bulk-upload)
 */

export type PrimaryCategory =
  // Home Services & Maintenance
  | 'cleaning'
  | 'handyperson'
  | 'plumbing'
  | 'electrical'
  | 'carpentry'
  | 'painting'
  | 'appliances'
  | 'heating_cooling'
  | 'roofing'
  | 'flooring'
  | 'windows_doors'
  | 'fencing'
  | 'pest_control'
  | 'pool_maintenance'
  | 'waste_removal'
  | 'waterproofing'
  | 'cladding'
  | 'plastering'
  | 'concreting'
  | 'paving'
  | 'decking'
  | 'landscaping'
  | 'gardening'
  | 'lawn_care'
  | 'tree_services'
  | 'irrigation'
  // Moving & Transport
  | 'moving'
  | 'removals'
  | 'delivery'
  | 'courier'
  | 'driving'
  // Beauty & Wellness
  | 'beauty'
  | 'hair_styling'
  | 'makeup'
  | 'nail_care'
  | 'massage'
  | 'fitness'
  | 'yoga'
  // Tech & IT
  | 'tech'
  | 'computer_repair'
  | 'phone_repair'
  | 'web_design'
  | 'app_development'
  | 'it_support'
  | 'audio_visual'
  | 'home_automation'
  // Education & Tutoring
  | 'tutoring'
  | 'music_lessons'
  | 'driving_lessons'
  | 'language_classes'
  | 'fitness_training'
  // Photography & Videography
  | 'photography'
  | 'videography'
  | 'photo_editing'
  | 'video_editing'
  // Business & Professional
  | 'business'
  | 'accounting'
  | 'legal'
  | 'marketing'
  | 'graphic_design'
  | 'content_writing'
  | 'translation'
  | 'virtual_assistant'
  | 'data_entry'
  | 'admin_work'
  // Events & Entertainment
  | 'events'
  | 'catering'
  | 'entertainment'
  | 'dj_services'
  | 'decoration'
  // Pet Care
  | 'pet_care'
  | 'pet_grooming'
  | 'pet_sitting'
  | 'dog_walking'
  // Childcare
  | 'childcare'
  | 'babysitting'
  | 'nanny'
  // Food & Cooking
  | 'cooking'
  | 'chef'
  | 'meal_prep'
  // Automotive
  | 'car_repair'
  | 'car_wash'
  | 'auto_electrician'
  | 'mechanic'
  // Fashion & Alterations
  | 'tailoring'
  | 'alterations'
  | 'sewing'
  // Miscellaneous
  | 'other';

/**
 * Secondary categories mapped to primary categories
 * This helps organize sub-services under main categories
 */
export const secondaryCategoriesMap: Record<PrimaryCategory, string[]> = {
  cleaning: [
    'House Cleaning',
    'Deep Cleaning',
    'Office Cleaning',
    'Commercial Cleaning',
    'End of Lease Cleaning',
    'Carpet Cleaning',
    'Upholstery Cleaning',
    'Window Cleaning',
    'Oven Cleaning',
    'Bathroom Cleaning',
    'Kitchen Cleaning',
    'Airbnb Cleaning',
    'Maid Service',
    'Housekeeping',
  ],
  handyperson: [
    'General Handyman',
    'Furniture Assembly',
    'Wall Mounting',
    'Picture Hanging',
    'Shelf Installation',
    'TV Mounting',
    'Mirror Hanging',
    'Clock Repair',
    'Pressure Washer Repair',
    'Treadmill Repair',
    'General Labour',
  ],
  plumbing: [
    'Plumbing Repair',
    'Leak Fixing',
    'Pipe Installation',
    'Bathroom Fittings',
    'Kitchen Fittings',
    'Water Heater Installation',
    'Drain Cleaning',
    'Toilet Repair',
    'Tap Installation',
    'Shower Installation',
    'Geyser Installation',
    'Water Purifier Installation',
  ],
  electrical: [
    'Electrical Repair',
    'Wiring',
    'Switch Installation',
    'Socket Installation',
    'Light Installation',
    'Fan Installation',
    'AC Installation',
    'AC Repair',
    'Generator Repair',
    'Solar Panel Installation',
    'Inverter Installation',
    'CCTV Installation',
    'Doorbell Installation',
    'Smoke Alarm Installation',
    'Christmas Light Installation',
    'Downlights Installation',
  ],
  carpentry: [
    'Cabinet Making',
    'Furniture Repair',
    'Door Repair',
    'Window Repair',
    'Timber Rot Repair',
    'Custom Furniture',
    'Woodwork',
  ],
  painting: [
    'Interior Painting',
    'Exterior Painting',
    'Wall Painting',
    'Fence Painting',
    'Furniture Painting',
    'Touch-up Painting',
  ],
  appliances: [
    'Appliance Repair',
    'Washing Machine Repair',
    'Refrigerator Repair',
    'AC Repair',
    'Microwave Repair',
    'Oven Repair',
    'Coffee Machine Repair',
    'Vacuum Cleaner Repair',
    'Appliance Installation',
  ],
  heating_cooling: [
    'AC Installation',
    'AC Repair',
    'AC Service',
    'Heater Installation',
    'Heater Repair',
    'Air Source Heat Pump',
  ],
  roofing: [
    'Roof Repair',
    'Roof Installation',
    'Gutter Cleaning',
    'Gutter Repair',
    'Insulation',
    'Flat Roofing',
  ],
  flooring: [
    'Floor Installation',
    'Floor Repair',
    'Timber Flooring',
    'Tile Installation',
    'Carpet Installation',
  ],
  windows_doors: [
    'Window Installation',
    'Window Repair',
    'Door Installation',
    'Door Repair',
    'Garage Door Installation',
    'Garage Door Repair',
    'Lock Installation',
    'Lock Repair',
    'Dog Door Installation',
  ],
  fencing: [
    'Fence Installation',
    'Fence Repair',
    'Fence Painting',
    'Temporary Fencing',
  ],
  pest_control: [
    'Pest Control Service',
    'Termite Control',
    'Rodent Control',
    'Cockroach Control',
    'Mosquito Control',
  ],
  pool_maintenance: [
    'Pool Cleaning',
    'Pool Maintenance',
    'Pool Repair',
  ],
  waste_removal: [
    'Rubbish Removal',
    'Garden Waste Collection',
    'Green Waste Collection',
    'Household Waste Disposal',
    'Skip Hire',
    'Asbestos Removal',
    'White Goods Removal',
    'Fridge Removal',
    'Washing Machine Removal',
    'Sofa Removal',
  ],
  waterproofing: [
    'Waterproofing Service',
    'Bathroom Waterproofing',
    'Terrace Waterproofing',
  ],
  cladding: [
    'Cladding Installation',
    'Cladding Repair',
  ],
  plastering: [
    'Plaster Repair',
    'Plastering Service',
    'Rendering',
  ],
  concreting: [
    'Concrete Work',
    'Concrete Cutting',
    'Driveway Repair',
    'Driveway Sealing',
  ],
  paving: [
    'Paving Installation',
    'Paving Repair',
  ],
  decking: [
    'Deck Installation',
    'Deck Repair',
    'Deck Sanding',
  ],
  landscaping: [
    'Landscape Design',
    'Garden Design',
    'Earthmoving',
    'Boring Excavation',
    'Hedging',
    'Irrigation Setup',
    'Irrigation Repair',
  ],
  gardening: [
    'Garden Maintenance',
    'Planting',
    'Pruning',
    'Weeding',
    'Garden Edging',
    'Shrub Trimming',
    'Bush Trimming',
  ],
  lawn_care: [
    'Lawn Mowing',
    'Lawn Maintenance',
    'Turf Laying',
    'Lawn Mower Repair',
  ],
  tree_services: [
    'Tree Removal',
    'Tree Pruning',
    'Palm Tree Removal',
    'Arborist Services',
  ],
  irrigation: [
    'Irrigation Installation',
    'Irrigation Repair',
    'Sprinkler Installation',
  ],
  moving: [
    'Moving & Packing',
    'Interstate Moving',
    'Local Moving',
    'Man With a Van',
    'Moving to Storage',
    'Student Removals',
  ],
  removals: [
    'Furniture Removal',
    'Appliance Removal',
    'Art Removal',
    'Shed Removal',
    'Sofa Removal',
  ],
  delivery: [
    'Food Delivery',
    'Grocery Delivery',
    'Package Delivery',
    'Local Delivery',
    'Same Day Delivery',
  ],
  courier: [
    'Courier Services',
    'Document Delivery',
    'Parcel Delivery',
  ],
  driving: [
    'Driving Service',
    'Chauffeur Service',
    'Taxi Service',
  ],
  beauty: [
    'Beauty Services',
    'Facial',
    'Waxing',
    'Threading',
    'Eyebrow Services',
  ],
  hair_styling: [
    'Haircut',
    'Hair Styling',
    'Hair Coloring',
    'Hair Treatment',
    'Blow Dry',
    'Mobile Haircut',
  ],
  makeup: [
    'Makeup Artist',
    'Bridal Makeup',
    'Party Makeup',
    'Hair & Makeup',
  ],
  nail_care: [
    'Manicure',
    'Pedicure',
    'Nail Art',
    'Nail Extension',
  ],
  massage: [
    'Therapeutic Massage',
    'Relaxation Massage',
    'Deep Tissue Massage',
    'Spa Services',
  ],
  fitness: [
    'Personal Training',
    'Gym Training',
    'Weight Loss Training',
    'HIIT Training',
    'Female Personal Training',
  ],
  yoga: [
    'Yoga Classes',
    'Yoga Instructor',
    'Pilates Instructor',
  ],
  tech: [
    'Tech Support',
    'Software Help',
    'Data Recovery',
    'Network Setup',
  ],
  computer_repair: [
    'Computer Repair',
    'Laptop Repair',
    'Data Recovery',
    'Virus Removal',
    'Software Installation',
  ],
  phone_repair: [
    'Mobile Phone Repair',
    'Smartphone Repair',
    'Screen Replacement',
    'Battery Replacement',
  ],
  web_design: [
    'Website Design',
    'Web Development',
    'E-commerce Development',
    'WordPress Development',
  ],
  app_development: [
    'Mobile App Development',
    'Android App Development',
    'iOS App Development',
    'App Design',
  ],
  it_support: [
    'IT Support',
    'Technical Support',
    'Network Support',
    'Server Setup',
  ],
  audio_visual: [
    'TV Installation',
    'TV Repair',
    'Home Theatre Setup',
    'Projector Installation',
    'Antenna Installation',
    'Sound System Installation',
  ],
  home_automation: [
    'Smart Home Setup',
    'Home Automation',
    'CCTV Installation',
    'Fire Alarm Installation',
    'Security System',
  ],
  tutoring: [
    'Math Tutor',
    'Science Tutor',
    'English Tutor',
    'Physics Tutor',
    'Chemistry Tutor',
    'Biology Tutor',
    'Accounting Tutor',
    'Engineering Tutor',
    'Exam Preparation',
  ],
  music_lessons: [
    'Guitar Lessons',
    'Piano Lessons',
    'Violin Lessons',
    'Music Production',
  ],
  driving_lessons: [
    'Driving Lessons',
    'Learner Driver Training',
  ],
  language_classes: [
    'Language Classes',
    'English Classes',
    'Spanish Classes',
    'French Classes',
  ],
  fitness_training: [
    'Fitness Training',
    'Personal Training',
    'Group Fitness',
  ],
  photography: [
    'Event Photography',
    'Wedding Photography',
    'Portrait Photography',
    'Product Photography',
    'Commercial Photography',
    'Aerial Photography',
    'Drone Photography',
    'Family Photoshoot',
  ],
  videography: [
    'Video Shooting',
    'Wedding Videography',
    'Event Videography',
    'Corporate Videography',
  ],
  photo_editing: [
    'Photo Editing',
    'Image Retouching',
  ],
  video_editing: [
    'Video Editing',
    'Video Production',
  ],
  business: [
    'Business Services',
    'Business Setup',
    'Business Consulting',
    'Project Management',
  ],
  accounting: [
    'Accounting Services',
    'Bookkeeping',
    'Tax Preparation',
    'Financial Planning',
    'Financial Reporting',
  ],
  legal: [
    'Legal Services',
    'Legal Consultation',
    'Document Preparation',
  ],
  marketing: [
    'Digital Marketing',
    'Social Media Marketing',
    'Content Marketing',
    'SEO Services',
    'Google AdWords',
    'Facebook Marketing',
    'Email Marketing',
    'Marketing Strategy',
  ],
  graphic_design: [
    'Graphic Design',
    'Logo Design',
    'Branding',
    'Packaging Design',
    'Sign Design',
  ],
  content_writing: [
    'Content Writing',
    'Blog Writing',
    'Copywriting',
    'Academic Writing',
    'Resume Writing',
    'Proofreading',
  ],
  translation: [
    'Translation Services',
    'Document Translation',
    'Spanish Translation',
  ],
  virtual_assistant: [
    'Virtual Assistant',
    'Data Entry',
    'Research Assistant',
  ],
  data_entry: [
    'Data Entry',
    'Data Processing',
  ],
  admin_work: [
    'Office Work',
    'Administrative Work',
    'Receptionist',
    'Customer Service',
  ],
  events: [
    'Event Planning',
    'Event Management',
    'Event Coordination',
  ],
  catering: [
    'Catering Services',
    'Banquet Catering',
    'Party Catering',
  ],
  entertainment: [
    'Entertainment Services',
    'DJ Services',
    'Singer',
    'Dancer',
    'Magician',
  ],
  dj_services: [
    'DJ Services',
    'Wedding DJ',
    'Party DJ',
  ],
  decoration: [
    'Event Decoration',
    'Wedding Decoration',
    'Party Decoration',
    'Balloon Decoration',
  ],
  pet_care: [
    'Pet Care Services',
    'Pet Sitting',
    'Pet Minding',
  ],
  pet_grooming: [
    'Pet Grooming',
    'Dog Grooming',
    'Cat Grooming',
    'Mobile Pet Grooming',
  ],
  pet_sitting: [
    'Pet Sitting',
    'Dog Sitting',
    'Cat Sitting',
  ],
  dog_walking: [
    'Dog Walking',
    'Pet Walking',
  ],
  childcare: [
    'Childcare Services',
    'Daycare',
  ],
  babysitting: [
    'Babysitting',
    'Child Minding',
  ],
  nanny: [
    'Nanny Services',
    'Live-in Nanny',
  ],
  cooking: [
    'Cooking Services',
    'Home Cooking',
    'Meal Preparation',
  ],
  chef: [
    'Private Chef',
    'Personal Chef',
    'Catering Chef',
  ],
  meal_prep: [
    'Meal Prep',
    'Meal Planning',
  ],
  car_repair: [
    'Car Repair',
    'Engine Repair',
    'Brake Repair',
    'Head Unit Installation',
  ],
  car_wash: [
    'Car Wash',
    'Car Detailing',
    'Mobile Car Wash',
  ],
  auto_electrician: [
    'Auto Electrician',
    'Car Electrical Repair',
    'Reversing Camera Installation',
    'UHF Radio Installation',
  ],
  mechanic: [
    'Mechanic Services',
    'Mobile Mechanic',
    'Bike Repair',
  ],
  tailoring: [
    'Tailoring Services',
    'Suit Tailor',
    'Custom Tailoring',
  ],
  alterations: [
    'Alterations',
    'Clothing Alterations',
    'Wedding Dress Alterations',
  ],
  sewing: [
    'Sewing Services',
    'Zipper Repair',
    'Dressmaking',
  ],
  other: [
    'Other Services',
    'Custom Service',
  ],
};

/**
 * Primary category display names
 */
export const primaryCategoryLabels: Record<PrimaryCategory, string> = {
  cleaning: 'Cleaning',
  handyperson: 'Handyperson',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  carpentry: 'Carpentry',
  painting: 'Painting',
  appliances: 'Appliances',
  heating_cooling: 'Heating & Cooling',
  roofing: 'Roofing',
  flooring: 'Flooring',
  windows_doors: 'Windows & Doors',
  fencing: 'Fencing',
  pest_control: 'Pest Control',
  pool_maintenance: 'Pool Maintenance',
  waste_removal: 'Waste Removal',
  waterproofing: 'Waterproofing',
  cladding: 'Cladding',
  plastering: 'Plastering',
  concreting: 'Concreting',
  paving: 'Paving',
  decking: 'Decking',
  landscaping: 'Landscaping',
  gardening: 'Gardening',
  lawn_care: 'Lawn Care',
  tree_services: 'Tree Services',
  irrigation: 'Irrigation',
  moving: 'Moving & Transport',
  removals: 'Removals',
  delivery: 'Delivery',
  courier: 'Courier Services',
  driving: 'Driving',
  beauty: 'Beauty',
  hair_styling: 'Hair Styling',
  makeup: 'Makeup',
  nail_care: 'Nail Care',
  massage: 'Massage',
  fitness: 'Fitness',
  yoga: 'Yoga',
  tech: 'Tech Support',
  computer_repair: 'Computer Repair',
  phone_repair: 'Phone Repair',
  web_design: 'Web Design',
  app_development: 'App Development',
  it_support: 'IT Support',
  audio_visual: 'Audio Visual',
  home_automation: 'Home Automation',
  tutoring: 'Tutoring',
  music_lessons: 'Music Lessons',
  driving_lessons: 'Driving Lessons',
  language_classes: 'Language Classes',
  fitness_training: 'Fitness Training',
  photography: 'Photography',
  videography: 'Videography',
  photo_editing: 'Photo Editing',
  video_editing: 'Video Editing',
  business: 'Business Services',
  accounting: 'Accounting',
  legal: 'Legal Services',
  marketing: 'Marketing',
  graphic_design: 'Graphic Design',
  content_writing: 'Content Writing',
  translation: 'Translation',
  virtual_assistant: 'Virtual Assistant',
  data_entry: 'Data Entry',
  admin_work: 'Admin Work',
  events: 'Events',
  catering: 'Catering',
  entertainment: 'Entertainment',
  dj_services: 'DJ Services',
  decoration: 'Decoration',
  pet_care: 'Pet Care',
  pet_grooming: 'Pet Grooming',
  pet_sitting: 'Pet Sitting',
  dog_walking: 'Dog Walking',
  childcare: 'Childcare',
  babysitting: 'Babysitting',
  nanny: 'Nanny',
  cooking: 'Cooking',
  chef: 'Chef',
  meal_prep: 'Meal Prep',
  car_repair: 'Car Repair',
  car_wash: 'Car Wash',
  auto_electrician: 'Auto Electrician',
  mechanic: 'Mechanic',
  tailoring: 'Tailoring',
  alterations: 'Alterations',
  sewing: 'Sewing',
  other: 'Other',
};

/**
 * All primary categories as array (for Mongoose enum)
 */
export const ALL_PRIMARY_CATEGORIES: PrimaryCategory[] = [
  'cleaning',
  'handyperson',
  'plumbing',
  'electrical',
  'carpentry',
  'painting',
  'appliances',
  'heating_cooling',
  'roofing',
  'flooring',
  'windows_doors',
  'fencing',
  'pest_control',
  'pool_maintenance',
  'waste_removal',
  'waterproofing',
  'cladding',
  'plastering',
  'concreting',
  'paving',
  'decking',
  'landscaping',
  'gardening',
  'lawn_care',
  'tree_services',
  'irrigation',
  'moving',
  'removals',
  'delivery',
  'courier',
  'driving',
  'beauty',
  'hair_styling',
  'makeup',
  'nail_care',
  'massage',
  'fitness',
  'yoga',
  'tech',
  'computer_repair',
  'phone_repair',
  'web_design',
  'app_development',
  'it_support',
  'audio_visual',
  'home_automation',
  'tutoring',
  'music_lessons',
  'driving_lessons',
  'language_classes',
  'fitness_training',
  'photography',
  'videography',
  'photo_editing',
  'video_editing',
  'business',
  'accounting',
  'legal',
  'marketing',
  'graphic_design',
  'content_writing',
  'translation',
  'virtual_assistant',
  'data_entry',
  'admin_work',
  'events',
  'catering',
  'entertainment',
  'dj_services',
  'decoration',
  'pet_care',
  'pet_grooming',
  'pet_sitting',
  'dog_walking',
  'childcare',
  'babysitting',
  'nanny',
  'cooking',
  'chef',
  'meal_prep',
  'car_repair',
  'car_wash',
  'auto_electrician',
  'mechanic',
  'tailoring',
  'alterations',
  'sewing',
  'other',
];

/**
 * Get all primary categories as array
 */
export function getAllPrimaryCategories(): PrimaryCategory[] {
  return ALL_PRIMARY_CATEGORIES;
}

/**
 * Get secondary categories for a primary category
 */
export function getSecondaryCategories(primaryCategory: PrimaryCategory): string[] {
  return secondaryCategoriesMap[primaryCategory] || [];
}

