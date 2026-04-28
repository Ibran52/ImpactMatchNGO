# ImpactMatchNGO

Project Structure & Architecture
This document provides a high-level overview of the ImpactMatch project structure and its architectural components.

Folder Structure
text
ImpactMatchNGO/
├── backend/                # Express.js Server
│   ├── src/
│   │   ├── config/         # Database and environment configurations
│   │   ├── controllers/    # Request handlers and logic
│   │   ├── middleware/     # Auth and validation middleware
│   │   ├── models/         # Mongoose schemas/models
│   │   ├── routes/         # API endpoint definitions
│   │   ├── services/       # Business logic (Matching Engine, Gemini API)
│   │   └── index.js        # Entry point
│   ├── package.json
│   └── .env
├── frontend/               # React + Vite + Tailwind Client
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── context/        # State management (Auth context)
│   │   ├── hooks/          # Custom React hooks
│   │   ├── pages/          # Main page views
│   │   ├── services/       # API call handlers
│   │   ├── App.tsx         # Main component / Router
│   │   └── main.tsx        # React entry point
│   ├── package.json
│   └── .env
├── render.yaml             # Render deployment configuration
└── README.md
Architectural Diagram
External Services
Database
Backend - Node/Express
Frontend - React/Vite
HTTP/JSON
AI Analysis
User Interface
Context/Hooks
API Services
API Routes
Controllers
Matching Engine
Mongoose Models
MongoDB Atlas
Google Gemini AI
Key Components
Backend
Matching Engine: Located in backend/src/services/, this core component runs periodically to match needs with available resources or volunteers using AI analysis.
Controllers: Handle specific business logic for users, needs, and matches.
Models: Define the data structure for Users, Needs, Matches, and Impact stories.
Frontend
Dashboard: Role-based dashboards for Volunteers, NGOs, and Donors.
Forms: Dynamic forms for identifying needs and registering users with location awareness.
Context: Centralized authentication and user state management.

