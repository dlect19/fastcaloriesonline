import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Smile } from 'lucide-react';
import { cn } from '@/lib/utils';

// Food-focused emojis organized for cuisine/menu categorization.
const FOOD_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: '🍚 Mains',
    emojis: ['🍚','🍛','🍲','🥘','🍝','🍜','🍣','🍱','🍙','🍘','🥟','🌯','🌮','🥙','🥗','🍳','🥚','🥩','🍖','🍗','🥓','🌭','🍔','🍟','🍕','🥪','🧆','🫔','🫕'],
  },
  {
    label: '🥬 Veg / Fruits',
    emojis: ['🥬','🥦','🥒','🌶️','🫑','🥕','🌽','🍅','🥔','🍠','🧄','🧅','🍆','🥑','🫛','🫘','🍄','🌰','🥜','🍇','🍉','🍌','🍍','🥭','🍎','🍏','🍑','🍐','🍒','🍓','🫐','🥝','🥥','🍋','🍊','🍈','🍅','🥗'],
  },
  {
    label: '🍞 Bakery / Snacks',
    emojis: ['🍞','🥖','🥐','🥯','🥨','🧈','🥞','🧇','🍪','🍩','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🥮','🍿','🍡','🍢','🍧','🍨','🍦'],
  },
  {
    label: '🥤 Drinks',
    emojis: ['☕','🍵','🥤','🧋','🧃','🥛','🍼','🍶','🍺','🍻','🍷','🍸','🍹','🍾','🥂','🥃','🧉','🧊'],
  },
  {
    label: '🐟 Sea / Protein',
    emojis: ['🐟','🐠','🐡','🦐','🦑','🦞','🦀','🦪','🍤','🥡','🍢','🍡','🥠','🫔'],
  },
  {
    label: '💊 Pharmacy',
    emojis: ['💊','💉','🩺','🩹','🌡️','🧴','🧼','🫧','🦷','🧪','🧬','🦠','❤️‍🩹','🩼'],
  },
  {
    label: '🛒 Market',
    emojis: ['🛒','🛍️','🥫','🧃','🧂','🍯','🧈','🧀','🥚','🍞','🌾','🥖','🧊','🧴','🥥','🌶️'],
  },
  {
    label: '🍽️ Misc',
    emojis: ['🍽️','🥄','🍴','🔪','🥢','🪔','🔥','💯','⭐','✨','🌟','🆕','🏷️','🎁','🎀','🌍','🇳🇬'],
  },
];

interface FoodEmojiPickerProps {
  value?: string;
  onSelect: (emoji: string) => void;
}

export function FoodEmojiPicker({ value, onSelect }: FoodEmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2 h-10"
        >
          <span className="text-xl leading-none">{value || '🍽️'}</span>
          <span className="text-sm text-muted-foreground">
            {value ? 'Change emoji' : 'Pick a food emoji'}
          </span>
          <Smile className="w-4 h-4 ml-auto text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <div className="flex gap-1 mb-2 overflow-x-auto pb-1">
          {FOOD_GROUPS.map((g, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                'text-xs px-2 py-1 rounded whitespace-nowrap transition-colors',
                active === i
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-accent'
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-8 gap-0.5 max-h-60 overflow-y-auto">
          {FOOD_GROUPS[active].emojis.map((emoji) => (
            <button
              key={emoji + active}
              type="button"
              onClick={() => {
                onSelect(emoji);
                setOpen(false);
              }}
              className={cn(
                'text-xl p-1.5 rounded hover:bg-accent transition-colors text-center',
                value === emoji && 'bg-primary/20 ring-1 ring-primary'
              )}
            >
              {emoji}
            </button>
          ))}
        </div>
        {value && (
          <div className="pt-2 mt-2 border-t flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => {
                onSelect('');
                setOpen(false);
              }}
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
