Directory structure:
└── zyneaa-home4you/
    ├── DOCKER.md
    ├── lefthook.yml
    ├── Makefile
    ├── .dockerignore
    ├── .env.example
    ├── doc/
    │   ├── ARCHITECTURE.md
    │   ├── FEED_ALGORITHM.md
    │   ├── ERD/
    │   │   └── DATABASE_ERD.md
    │   └── SD/
    │       ├── AUTH_LOGIN.md
    │       ├── AUTH_REFRESH.md
    │       ├── AUTH_REGISTRATION.md
    │       ├── PASSWORD_FORGET.md
    │       └── USER_PROFILE.md
    ├── experiments/
    │   └── sunfire/
    │       ├── README.md
    │       ├── __init__.py
    │       ├── Makefile
    │       ├── parameters.py
    │       ├── requirements.txt
    │       ├── sunfire.md
    │       ├── sunfire_score.csv
    │       ├── generators/
    │       │   ├── __init__.py
    │       │   ├── post_gen.py
    │       │   ├── score.py
    │       │   └── user_gen.py
    │       └── simulators/
    │           ├── __init__.py
    │           ├── boost.py
    │           ├── normal_simulation.ipynb
    │           └── scores.ipynb
    ├── infrastructure/
    │   └── docker/
    │       ├── docker-compose.dev.yml
    │       ├── docker-compose.yml
    │       └── logs/
    │           ├── .3eb75c427e9295b318a41ead7aeb17b9e5a9b438-audit.json
    │           └── .a0653ac0436970442cff599afba685139dde018a-audit.json
    ├── services/
    │   └── core/
    │       ├── Dockerfile
    │       ├── Dockerfile.dev
    │       ├── eslint.config.mjs
    │       ├── GEMINI.md
    │       ├── nodemon.json
    │       ├── package.json
    │       ├── tsconfig.json
    │       ├── tsconfig.test.json
    │       ├── vitest.config.ts
    │       ├── .prettierignore
    │       ├── .prettierrc
    │       ├── scripts/
    │       │   └── wait-for-services.sh
    │       ├── src/
    │       │   ├── app.mts
    │       │   ├── index.mts
    │       │   ├── server.mts
    │       │   ├── config/
    │       │   │   ├── cloudflare.mts
    │       │   │   ├── cors.mts
    │       │   │   ├── db.mts
    │       │   │   ├── index.mts
    │       │   │   ├── mailer.mts
    │       │   │   └── redis.mts
    │       │   ├── middlewares/
    │       │   │   ├── auth.middleware.mts
    │       │   │   ├── globalErrorHandler.middleware.mts
    │       │   │   ├── index.mts
    │       │   │   ├── morgan.middleware.mts
    │       │   │   ├── rateLimit.middleware.mts
    │       │   │   ├── rbac.middleware.mts
    │       │   │   ├── requestId.middleware.mts
    │       │   │   ├── signHMAC.middleware.mts
    │       │   │   └── validation.middleware.mts
    │       │   ├── modules/
    │       │   │   ├── auth/
    │       │   │   │   ├── auth.model.mts
    │       │   │   │   ├── auth.service.mts
    │       │   │   │   ├── index.mts
    │       │   │   │   ├── controllers/
    │       │   │   │   │   └── v1/
    │       │   │   │   │       └── auth.controller.mts
    │       │   │   │   ├── dtos/
    │       │   │   │   │   ├── login.dto.mts
    │       │   │   │   │   ├── logout.dto.mts
    │       │   │   │   │   ├── refresh.dto.mts
    │       │   │   │   │   ├── register.dto.mts
    │       │   │   │   │   ├── sendOtp.dto.mts
    │       │   │   │   │   └── verifyOtp.dto.mts
    │       │   │   │   ├── routes/
    │       │   │   │   │   └── v1.auth.routes.mts
    │       │   │   │   └── types/
    │       │   │   │       └── authSession.type.mts
    │       │   │   ├── image/
    │       │   │   │   ├── image.service.mts
    │       │   │   │   ├── index.mts
    │       │   │   │   ├── controllers/
    │       │   │   │   │   └── v1/
    │       │   │   │   │       └── image.controller.mts
    │       │   │   │   ├── dtos/
    │       │   │   │   │   └── imageUploadCheck.dto.mts
    │       │   │   │   └── routes/
    │       │   │   │       └── v1.image.routes.mts
    │       │   │   ├── otp-code/
    │       │   │   │   ├── otpCode.model.mts
    │       │   │   │   ├── otpCode.service.mts
    │       │   │   │   └── types/
    │       │   │   │       ├── channel.type.mts
    │       │   │   │       ├── otpCode.type.mts
    │       │   │   │       └── otpType.type.mts
    │       │   │   ├── password-forget/
    │       │   │   │   ├── index.mts
    │       │   │   │   ├── password-forget.service.mts
    │       │   │   │   ├── controllers/
    │       │   │   │   │   └── password-forget.controller.mts
    │       │   │   │   ├── dtos/
    │       │   │   │   │   ├── forgot-password.dto.mts
    │       │   │   │   │   └── reset-password.dto.mts
    │       │   │   │   └── routes/
    │       │   │   │       └── v1.password-forget.routes.mts
    │       │   │   ├── post/
    │       │   │   │   ├── index.mts
    │       │   │   │   ├── post.model.mts
    │       │   │   │   ├── post.service.mts
    │       │   │   │   ├── controllers/
    │       │   │   │   │   └── v1/
    │       │   │   │   │       └── post.controller.mts
    │       │   │   │   ├── dtos/
    │       │   │   │   │   ├── addPost.dto.mts
    │       │   │   │   │   ├── deletePost.dto.mts
    │       │   │   │   │   ├── listPosts.dto.mts
    │       │   │   │   │   └── updatePost.dto.mts
    │       │   │   │   ├── routes/
    │       │   │   │   │   └── v1.post.routes.mts
    │       │   │   │   └── types/
    │       │   │   │       └── post.type.mts
    │       │   │   ├── property/
    │       │   │   │   ├── index.mts
    │       │   │   │   ├── property.model.mts
    │       │   │   │   ├── property.service.mts
    │       │   │   │   ├── controllers/
    │       │   │   │   │   └── v1/
    │       │   │   │   │       └── property.controller.mts
    │       │   │   │   ├── dtos/
    │       │   │   │   │   ├── createProperty.dto.mts
    │       │   │   │   │   ├── geoSearch.dto.mts
    │       │   │   │   │   ├── queryProperty.dto.mts
    │       │   │   │   │   └── updateProperty.dto.mts
    │       │   │   │   ├── routes/
    │       │   │   │   │   └── v1.property.routes.mts
    │       │   │   │   └── types/
    │       │   │   │       ├── property.types.mts
    │       │   │   │       ├── propertyCatagory.type.mts
    │       │   │   │       └── propertyType.type.mts
    │       │   │   ├── sys/
    │       │   │   │   ├── index.mts
    │       │   │   │   ├── controllers/
    │       │   │   │   │   └── v1/
    │       │   │   │   │       └── health.controller.mts
    │       │   │   │   └── routes/
    │       │   │   │       └── v1.health.routes.mts
    │       │   │   ├── transaction/
    │       │   │   │   ├── index.mts
    │       │   │   │   ├── transaction.model.mts
    │       │   │   │   ├── transaction.service.mts
    │       │   │   │   └── types/
    │       │   │   │       └── transaction.type.mts
    │       │   │   ├── user/
    │       │   │   │   ├── index.mts
    │       │   │   │   ├── user.model.mts
    │       │   │   │   ├── user.service.mts
    │       │   │   │   ├── controllers/
    │       │   │   │   │   └── v1/
    │       │   │   │   │       └── user.controller.mts
    │       │   │   │   ├── dtos/
    │       │   │   │   │   ├── create-user.dto.mts
    │       │   │   │   │   ├── update-user.dto.mts
    │       │   │   │   │   └── user-response.dto.mts
    │       │   │   │   ├── routes/
    │       │   │   │   │   └── v1.user.routes.mts
    │       │   │   │   └── types/
    │       │   │   │       ├── express.d.ts
    │       │   │   │       └── user.type.mts
    │       │   │   └── user-profile/
    │       │   │       ├── index.mts
    │       │   │       ├── userProfile.model.mts
    │       │   │       ├── userProfile.service.mts
    │       │   │       ├── controllers/
    │       │   │       │   └── v1/
    │       │   │       │       └── userProfile.controller.mts
    │       │   │       ├── dtos/
    │       │   │       │   └── updateProfile.dto.mts
    │       │   │       ├── routes/
    │       │   │       │   └── v1.userProfile.routes.mts
    │       │   │       └── types/
    │       │   │           └── userProfile.types.mts
    │       │   ├── routes/
    │       │   │   ├── index.mts
    │       │   │   └── v1.routes.mts
    │       │   ├── shared/
    │       │   │   ├── dtos/
    │       │   │   │   ├── index.mts
    │       │   │   │   └── property.shared.dto.mts
    │       │   │   ├── types/
    │       │   │   │   ├── currencyType.type.mts
    │       │   │   │   ├── express.d.mts
    │       │   │   │   ├── index.mts
    │       │   │   │   ├── mimeType.type.mts
    │       │   │   │   ├── status.type.mts
    │       │   │   │   └── transactionType.type.mts
    │       │   │   └── validations/
    │       │   │       ├── env.validation.mts
    │       │   │       ├── index.mts
    │       │   │       └── jwt.validation.mts
    │       │   └── utils/
    │       │       ├── appError.mts
    │       │       ├── index.mts
    │       │       ├── jwt.mts
    │       │       ├── krypto.mts
    │       │       ├── logger.mts
    │       │       └── validation.mts
    │       └── tests/
    │           ├── setup.ts
    │           ├── integration/
    │           │   ├── auth.routes.test.ts
    │           │   ├── health.routes.test.ts
    │           │   ├── password-forget.routes.test.ts
    │           │   ├── property.routes.test.ts
    │           │   ├── user.routes.test.ts
    │           │   └── userProfile.routes.test.ts
    │           ├── load_tests/
    │           │   ├── rateLimit.loadtest.d.ts
    │           │   ├── rateLimit.loadtest.js
    │           │   ├── rateLimit.loadtest.ts
    │           │   ├── rateLimitOk.loadtest.d.ts
    │           │   ├── rateLimitOk.loadtest.js
    │           │   └── rateLimitOk.loadtest.ts
    │           └── unit/
    │               ├── auth/
    │               │   └── auth.service.test.ts
    │               ├── middlewares/
    │               │   ├── auth.middleware.test.ts
    │               │   └── rateLimit.middleware.test.ts
    │               ├── otp-code/
    │               │   └── otpCode.service.test.ts
    │               ├── password-forget/
    │               │   └── password-forget.service.test.ts
    │               ├── property/
    │               │   └── property.service.test.ts
    │               ├── user/
    │               │   ├── user.controller.test.ts
    │               │   └── user.service.test.ts
    │               ├── user-profile/
    │               │   └── userProfile.service.test.ts
    │               └── utils/
    │                   ├── appError.test.ts
    │                   ├── jwt.test.ts
    │                   └── krypto.test.ts
    ├── .github/
    │   ├── dependabot.yml
    │   └── workflows/
    │       ├── docker.yml
    │       └── lint-and-fmt.yml
    └── .husky/
        └── _/
            ├── jre-commit
            ├── pre-commit
            └── prepare-commit-msg
