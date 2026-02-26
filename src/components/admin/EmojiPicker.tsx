import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Smile } from 'lucide-react';

const EMOJI_CATEGORIES = [
  {
    label: '😀 Smileys',
    emojis: ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😗','😙','😚','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','😴','🥱','😜','😝','😛','🤑','🤠','😈','👿','👹','👻','💀','☠️','👽','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾'],
  },
  {
    label: '🎉 Celebration',
    emojis: ['🎉','🎊','🥳','🎈','🎁','🎂','🎀','🏆','🥇','🥈','🥉','⭐','🌟','✨','💫','🔥','💥','💯','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💝','💖','💗','💓','💞','💕','💘','💟','❣️','💔'],
  },
  {
    label: '🍔 Food',
    emojis: ['🍔','🍕','🌮','🌯','🍟','🍗','🍖','🥩','🍳','🥘','🍲','🥗','🍱','🍣','🍙','🍚','🍛','🍜','🍝','🍞','🥐','🥖','🧁','🍰','🎂','🍩','🍪','🍫','🍬','🍭','☕','🍵','🥤','🍺','🍻','🥂','🍷','🍹','🧃','🥛','🍶'],
  },
  {
    label: '🚀 Objects',
    emojis: ['🚀','📢','📣','🔔','🔕','📱','💻','⌚','📧','💰','💵','💸','🛒','🛍️','📦','🏷️','🎯','🎮','🎧','🎵','🎶','🔑','🔒','🔓','⚡','💡','🌈','☀️','🌙','⭐','🌍','🏠','🏢','🏪','🚗','🚲','✈️','⏰','📅','✅','❌','⚠️','ℹ️','🆕','🆓','🔥','💪','👍','👎','👏','🙏','🤝'],
  },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState(0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="icon" className="shrink-0">
          <Smile className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end">
        <div className="flex gap-1 mb-2 overflow-x-auto pb-1">
          {EMOJI_CATEGORIES.map((cat, i) => (
            <button
              key={i}
              onClick={() => setActiveCategory(i)}
              className={`text-xs px-2 py-1 rounded whitespace-nowrap ${
                activeCategory === i
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-accent'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-8 gap-0.5 max-h-48 overflow-y-auto">
          {EMOJI_CATEGORIES[activeCategory].emojis.map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                onSelect(emoji);
                setOpen(false);
              }}
              className="text-xl p-1 rounded hover:bg-accent transition-colors text-center"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
