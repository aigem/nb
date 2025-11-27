# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

nbDraw (Nano Banana Pro) is a pure frontend web application built with React/Preact that provides a chat interface for interacting with Google's Gemini 3 Pro AI model. The application supports multimodal inputs (text and images), displays AI thinking processes, includes mini-games for waiting periods, and manages image history with persistent storage.

**Key Features:**
- **Multimodal Chat**: Text and image inputs with streaming responses
- **Batch Generation**: Three modes - Normal batch, Multi-image single prompt, Image-multi-prompt
- **Image Re-editing**: Click generated images to use as reference in new generations
- **Prompt Library**: Built-in curated prompt templates from GitHub
- **Quick Prompt Picker**: Trigger with `/t` for fast prompt selection
- **Image History**: Persistent storage with thumbnail optimization
- **Arcade Mode**: Mini-games during AI thinking periods
- **Black-Gold Aesthetic**: Amber/gold color scheme throughout the UI
- **PWA Support**: Installable as standalone app

**Key Architecture Decisions:**
- **Preact Aliasing**: Uses Preact instead of React for smaller bundle size. All React imports are aliased to `preact/compat` in both `vite.config.ts` and `tsconfig.json`
- **Pure Frontend**: No backend server - all API calls go directly to Gemini endpoints from the browser
- **Persistent Storage**: Uses IndexedDB (via `idb-keyval`) for large data (images) and Zustand persistence for settings/metadata
- **Image Storage Strategy**: Thumbnails stored in Zustand state, full images stored separately in IndexedDB to avoid state bloat
- **Lazy API Key Check**: API key is only validated when user attempts to generate content, not on app startup

## Development Commands

### Build and Development
```bash
# Install dependencies (must use Bun, enforced by preinstall hook)
bun install

# Start dev server (runs on http://localhost:3000)
bun dev

# Build for production
bun build

# Preview production build
bun preview
```

**Note:** This project enforces Bun as the package manager through a `preinstall` script. Using npm/yarn/pnpm will fail.

## State Management Architecture

### Two-Store Pattern
The application uses two separate Zustand stores:

1. **`useAppStore`** (`src/store/useAppStore.ts`) - Persistent application state:
   - API key, settings, chat messages
   - Image history (thumbnails only, full images in IndexedDB)
   - Balance information
   - Persisted to IndexedDB via custom storage adapter

2. **`useUiStore`** (`src/store/useUiStore.ts`) - Ephemeral UI state:
   - Modal/panel visibility
   - Toasts and dialogs
   - Batch generation mode (`'off' | 'normal' | 'multi-image' | 'image-multi-prompt'`)
   - Pending reference image for re-editing
   - Temporary references (attachments, abort controllers)
   - NOT persisted

### Batch Generation Modes

The application supports three batch generation modes (configured in `InputArea.tsx`):

1. **Normal Batch** (`'normal'`):
   - Repeat the same prompt + images N times (1-4)
   - User selects count via number buttons
   - Example: Generate 4 variations of the same concept

2. **Multi-Image Single Prompt** (`'multi-image'`):
   - One prompt applied to each uploaded image separately
   - Generates N images (where N = number of attachments)
   - Example: Same style applied to multiple reference images

3. **Image-Multi-Prompt** (`'image-multi-prompt'`):
   - Each image paired with a different prompt
   - Prompts separated by commas or newlines
   - If fewer prompts than images, prompts cycle/repeat
   - Example: 3 images with prompts "A, B, C" → Image1+A, Image2+B, Image3+C

All batch tasks execute sequentially with 500ms delay between generations to avoid rate limiting.

### Image History Storage Pattern
Images use a split storage approach to optimize performance:
- **State (Zustand)**: Stores thumbnails (~200x200px) and metadata
- **IndexedDB**: Stores full-resolution images keyed by `image_data_${id}`
- **Migration**: `cleanInvalidHistory()` migrates old format (full images in state) to new format

## API Integration

### Gemini Service (`src/services/geminiService.ts`)
Handles communication with Google GenAI SDK:

**Key Functions:**
- `streamGeminiResponse()`: Streaming API calls (default)
- `generateContent()`: Non-streaming API calls
- Both functions filter out `thought` parts from history before sending to API
- Error handling includes Chinese error messages for common API errors (401, 403, 429, etc.)

**Configuration:**
- Custom endpoint: `settings.customEndpoint` (default: `https://api.kuai.host`)
- Model name: `settings.modelName` (default: `gemini-3-pro-image-preview`)
- Supports Google Search Grounding via `settings.useGrounding`
- Thinking process visibility via `settings.enableThinking`

### Balance Service (`src/services/balanceService.ts`)
Queries API balance from OpenAI-compatible endpoints:
- Fetches subscription limit: `/v1/dashboard/billing/subscription`
- Fetches usage (100 days): `/v1/dashboard/billing/usage`
- Supports "unlimited" accounts (hardLimitUsd >= 100000000)

## Component Architecture

### Lazy Loading Strategy
All heavy components are lazy-loaded with retry logic (`src/utils/lazyLoadUtils.ts`):
- `ApiKeyModal`, `SettingsPanel`, `ImageHistoryPanel`, `PromptLibraryPanel`
- All game components (`SnakeGame`, `DinoGame`, `LifeGame`, `Puzzle2048`)
- Preloaded after initial mount to prepare for user interaction

### Main Component Flow
1. **`App.tsx`**: Root component, handles theme, PWA install prompt, header navigation
2. **`ChatInterface.tsx`**: Message list and scroll management
3. **`InputArea.tsx`**: Text input + image upload (supports drag-and-drop)
4. **`MessageBubble.tsx`**: Renders individual messages with Markdown + image download
5. **`ThinkingIndicator.tsx`**: Shows AI thinking animation and arcade mode entry

### Arcade Mode (Waiting Games)
When AI is thinking (with `enableThinking: true`), users can play mini-games:
- Triggered via gamepad icon in `ThinkingIndicator`
- Games: Snake, Dino Runner, 2048, Conway's Game of Life
- Auto-adapts to current theme and device type

## Type System (`src/types.ts`)

### Core Types
- **`Part`**: Text or image content, optionally marked as `thought` (thinking process)
- **`Content`**: Array of parts with role (`user` | `model`)
- **`ChatMessage`**: Extends Content with id, timestamp, error state, thinking duration
- **`Attachment`**: File + preview + base64 data for API
- **`ImageHistoryItem`**: Thumbnail + metadata, optional full base64 (stored in IDB)

## Configuration and URL Parameters

### Supported URL Parameters
- `?apikey=xxx`: Pre-fill API key
- `?endpoint=https://example.com`: Override API endpoint
- `?model=gemini-xyz`: Override model name

### Settings (`AppSettings` type)
- Resolution: `'1K' | '2K' | '4K'`
- Aspect ratio: `'Auto' | '1:1' | '3:4' | '4:3' | '9:16' | '16:9' | '21:9'`
- Model selection: `'gemini-3-pro-image-preview' | 'gemini-2.5-flash-image-preview' | 'gemini-2.5-flash-image'`
- Google Search Grounding toggle
- Thinking process visibility
- Stream vs non-stream response
- Theme: `'light' | 'dark' | 'system'`

### UI Theme
The application uses a **black-gold aesthetic** with amber (#F59E0B) as the primary accent color:
- Primary buttons and active states: Amber/Gold
- Icons and highlights: Amber shades
- Background: Black/Dark gray to White gradient
- All interactive elements use amber for hover/focus states

## Key User Features

### Image Re-editing
Users can click generated images to use them as reference in new generations:

1. **Conversation Images** (`MessageBubble.tsx`):
   - Hover over generated images to see "再次编辑" (Edit) button
   - Click to add image to input attachments automatically

2. **History Images** (`ImageHistoryPanel.tsx`):
   - Grid view: Hover shows amber edit button
   - Lightbox view: Bottom action bar includes "再次编辑" button
   - Click to add to input and close panel

Implementation uses `pendingReferenceImage` state in `useUiStore` that `InputArea` monitors and auto-converts to attachment.

### Prompt Quick Selection
- Type `/t` in input to trigger `PromptQuickPicker`
- Replaces `/t` with selected prompt
- Keyboard navigation: Arrow keys + Enter
- Categories filterable

### API Key Handling
- No longer checks for API key on app startup
- Modal only appears when user attempts generation without key
- **Always-visible Key icon button** in header allows users to set/change API key anytime
- Balance display only shows when API key is present
- Clear API Key button in settings only appears when key exists
- Header buttons (GitHub, theme toggle, Key) always visible for better UX

## PWA Support

- Service worker via `vite-plugin-pwa`
- Manifest configured for standalone mode
- Install prompt captured and shown in header
- Theme color dynamically updated based on dark/light mode

## Testing Features

### Testing Image Upload and Re-edit
1. **Upload**: Click camera icon, drag images, or paste anywhere
2. **Re-edit from conversation**:
   - Generate an image
   - Hover over the generated image in chat
   - Click amber "再次编辑" button
   - Image appears in input attachment area
3. **Re-edit from history**:
   - Click image history icon (with amber pulse badge)
   - Hover over thumbnail → click amber edit button
   - OR click thumbnail → click "再次编辑" in lightbox modal

### Testing Batch Generation
1. **Normal Batch**:
   - Click "普通批量" button
   - Select count (1-4)
   - Enter prompt + optional images
   - Send to generate N variations

2. **Multi-Image Single Prompt**:
   - Upload 3+ images
   - Click "多图单词" button
   - Enter one prompt
   - Each image generates separately with same prompt

3. **Image-Multi-Prompt**:
   - Upload 3+ images
   - Click "图片对多词" button
   - Enter prompts separated by commas: "prompt A, prompt B, prompt C"
   - Image1 pairs with prompt A, Image2 with B, etc.

### Testing Prompt Features
1. **Quick Picker**: Type `/t` in input to trigger selector
2. **Prompt Library**: Click Sparkles icon in header (requires API key)

### Testing Image History
1. Generate images via chat
2. Click image icon in header (with amber pulse badge)
3. View grid, click for full preview with prompt details
4. Download individual or clear all
5. Test re-edit from both grid and lightbox views

## Common Development Patterns

### Adding New Settings
1. Update `AppSettings` interface in `src/types.ts`
2. Add default value in `useAppStore` initial state
3. Add UI control in `SettingsPanel.tsx`
4. Use via `settings` object in relevant components

### Adding New UI State
1. Add to `useUiStore` if non-persistent (modals, panels)
2. Add to `useAppStore` only if needs persistence

### Error Handling
- Gemini errors are caught and formatted in Chinese via `formatGeminiError()`
- Toast notifications for user feedback (via `useUiStore` actions)
- Global dialog for important alerts (via `GlobalDialog` component)

## Build Configuration

### Vite Config (`vite.config.ts`)
- Server runs on port 3000, host 0.0.0.0
- Manual chunks: `google-genai`, `markdown-libs` (optimizes caching)
- Preact aliases configured for React compatibility
- PWA with auto-update and dev mode enabled

### TypeScript Config (`tsconfig.json`)
- Target: ES2022
- JSX Import Source: `preact`
- Path alias: `@/*` → `./src/*`
- React/React-DOM aliased to Preact compat

## Known Issues and Constraints

- Balance API only works with OpenAI-compatible endpoints (not native Gemini API)
- Some models don't support thinking mode - disable `enableThinking` if errors occur
- Image uploads limited to 14 attachments per message
- History limited to 100 images (oldest auto-pruned)
