// Test environment variables setup
process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.HOST = '127.0.0.1';
process.env.DATABASE_CONTROL_URL = 'postgres://rota:rota_local_dev@localhost:5432/control_plane';
process.env.DATABASE_CONTROL_READ_URL = 'postgres://rota:rota_local_dev@localhost:5432/control_plane';
process.env.DATABASE_SHARD_0_URL = 'postgres://rota:rota_local_dev@localhost:5432/rota_shard_0';
process.env.DATABASE_SHARD_0_READ_URL = 'postgres://rota:rota_local_dev@localhost:5432/rota_shard_0';
process.env.DATABASE_SHARD_1_URL = 'postgres://rota:rota_local_dev@localhost:5432/rota_shard_1';
process.env.DATABASE_SHARD_1_READ_URL = 'postgres://rota:rota_local_dev@localhost:5432/rota_shard_1';
process.env.REDIS_CACHE_URL = 'redis://localhost:6379';
process.env.REDIS_QUEUE_URL = 'redis://localhost:6380';
process.env.JWT_SECRET = 'test_jwt_secret_at_least_32_characters_long_for_tests';
process.env.REFRESH_TOKEN_SECRET = 'test_refresh_token_secret_at_least_32_chars_long';
process.env.RESEND_API_KEY = 're_test_key_dummy_1234567890';
process.env.EMAIL_FROM = 'noreply@rota.app';
